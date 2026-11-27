<template>
  <span ref="root" class="rp-add">
    <!-- in a row, a small round one; in a page's header, one of its round buttons (the icon alone, its name on hover) -->
    <button :class="small ? 'rp-mini rp-add-mini' : 'rp-act'" :title="title" :aria-label="title" :aria-expanded="open" @click.stop="toggle">
      <i :class="['rp-i', small ? 'rp-i-add' : 'rp-i-add-list']" aria-hidden="true"></i>
    </button>
    <!-- a phone: the menu is a sheet from the bottom; touching outside it closes it -->
    <div v-if="open" class="rp-menu-backdrop" @click.stop="close()"></div>
    <div v-if="open && !choosing" :class="['rp-menu', 'rp-menu-lists', { 'rp-menu-up': up }]" role="dialog" :aria-label="title" @click.stop>
      <p class="rp-menu-head rp-muted rp-small">Guardar {{ what }} en…</p>
      <input v-if="state.playlists.length > 6" v-model="filter" class="rp-input rp-menu-filter" type="search" placeholder="Buscar una lista" aria-label="Buscar una lista" />
      <p v-if="loading" class="rp-muted rp-small rp-menu-hint"><span class="rp-spin"></span> Mirando en qué listas está…</p>
      <template v-else>
        <label v-for="p in shown" :key="p.id" class="rp-menu-item rp-menu-pick">
          <input type="checkbox" :checked="ticked.has(p.id)" :disabled="busy" @change="tick(p.id)" />
          <span class="rp-menu-pick-text">
            <span class="rp-ellipsis">{{ p.name }}</span>
            <small v-if="via(p.id)" class="rp-muted rp-tiny rp-ellipsis">{{ via(p.id) }}</small>
          </span>
        </label>
        <p v-if="filter && !shown.length" class="rp-muted rp-small rp-menu-hint">Ninguna lista se llama así.</p>
      </template>
      <form class="rp-menu-new" @submit.prevent="create">
        <input v-model="newName" class="rp-input" placeholder="Nueva lista…" maxlength="120" aria-label="Nombre de la lista nueva" />
        <button class="rp-btn rp-small" :disabled="!newName.trim() || busy">Crear</button>
      </form>
      <label v-if="kind === 'artist' && added.length" class="rp-menu-check">
        <input v-model="newToo" type="checkbox" /> Añadir sus temas nuevos
      </label>
      <div class="rp-menu-actions">
        <button class="rp-btn rp-small" :disabled="busy" @click="close">Cancelar</button>
        <button class="rp-btn rp-small rp-primary" :disabled="busy || loading || (!added.length && !removed.length)" @click="done">
          <span v-if="busy" class="rp-spin"></span> Hecho
        </button>
      </div>
      <p v-if="hint && added.length" class="rp-muted rp-tiny rp-menu-hint">{{ hint }}</p>
    </div>
    <div v-else-if="open && choosing" :class="['rp-menu', 'rp-menu-wide', { 'rp-menu-up': up }]" role="dialog" :aria-label="`Qué entra en ${addedNames}`" @click.stop>
      <p class="rp-menu-head rp-small"><strong>Qué entra en {{ addedNames }}</strong></p>
      <p v-if="!choices" class="rp-muted rp-small rp-menu-hint"><span class="rp-spin"></span> Cargando…</p>
      <p v-else-if="!choices.length" class="rp-muted rp-small rp-menu-hint">No hay nada que elegir: entra entero.</p>
      <template v-else>
        <p class="rp-muted rp-tiny rp-menu-hint">Desmarca lo que no quieras en {{ added.length === 1 ? 'la lista' : 'las listas' }}.</p>
        <ul class="rp-menu-choices">
          <li v-for="c in choices" :key="c.key">
            <label class="rp-check">
              <input v-model="c.keep" type="checkbox" :disabled="!c.key" />
              <img v-if="c.cover" :src="c.cover" alt="" loading="lazy" />
              <span class="rp-ellipsis">{{ c.title }}</span>
              <small class="rp-muted">{{ c.note }}</small>
            </label>
          </li>
        </ul>
      </template>
      <div class="rp-menu-actions">
        <button class="rp-btn rp-small" :disabled="busy" @click="choosing = false">Atrás</button>
        <button class="rp-btn rp-small rp-primary" :disabled="busy || !choices || (choices.length > 0 && !choices.some((c) => c.keep))" @click="apply">
          <span v-if="busy" class="rp-spin"></span> Hecho
        </button>
      </div>
    </div>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import type { Containing, ItemKind } from '../lib/api'
import { fmtTime, kindLabel, fmtDate } from '../lib/library'
import { useStore } from '../lib/store'

/**
 * "＋ Añadir a lista" for a song, a release or an artist (Deezer ids), as Spotify's: every list with a tick where it
 * is already (a song also when it comes in with a release or an artist of the list); tick and untick several and
 * «Hecho» adds and takes out at once. Adding a release or an artist asks first what of it comes in.
 */
const props = withDefaults(defineProps<{ kind: Exclude<ItemKind, 'file'>; id: number; followed?: boolean; small?: boolean }>(), { followed: true, small: false })
/** `added`: it went into a list (what it needs may be downloading now). */
const emit = defineEmits<{ added: [] }>()
const { api, state, notify, refreshPlaylists, refreshFollows, refreshDownloads } = useStore()
const root = ref<HTMLElement>()
const open = ref(false)
const busy = ref(false)
const loading = ref(false)
const newName = ref('')
const newToo = ref(true)
const filter = ref('')
/** opens upwards when there is no room below (the last songs of a page, over the player's bar) */
const up = ref(false)
const MENU_H = 440
const BAR_H = 96

/** Where it is now (by list), and the lists ticked in the menu. */
const holding = ref(new Map<number, Containing>())
const ticked = reactive(new Set<number>())
const added = computed(() => state.playlists.filter((p) => ticked.has(p.id) && !holding.value.has(p.id)))
const removed = computed(() => [...holding.value.values()].filter((h) => !ticked.has(h.playlist_id)))
const addedNames = computed(() => (added.value.length === 1 ? `«${added.value[0].name}»` : `${added.value.length} listas`))

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
/** The lists where it is first (as Spotify), then the rest as they come; filtered by the search box. */
const shown = computed(() => {
  const q = plain(filter.value.trim())
  return state.playlists.filter((p) => !q || plain(p.name).includes(q))
    .sort((a, b) => Number(!holding.value.has(a.id)) - Number(!holding.value.has(b.id)))
})
function via(playlistId: number): string {
  const h = holding.value.get(playlistId)
  if (!h || h.via === 'own' || h.via === 'file') return ''
  return h.via === 'release' ? `Con el disco «${h.title}»` : `Con ${h.title}`
}

interface Choice { key: string; id: number; title: string; cover: string | null; note: string; keep: boolean }
const choosing = ref(false)
const choices = ref<Choice[] | null>(null)

const what = computed(() => ({ song: 'la canción', release: 'el disco', artist: 'el artista' })[props.kind])
const title = computed(() => `Añadir ${what.value} a una lista`)
const hint = computed(() => (props.kind === 'artist' && !props.followed ? 'Aún no descargas a este artista: se empezará a bajar su música y lo nuevo que saque.'
  : props.kind !== 'artist' ? 'Si aún no lo tienes, se baja (solo esto, sin descargar todo lo del artista).' : ''))

function onOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) close()
}
function close() {
  open.value = false
  choosing.value = false
  filter.value = ''
  document.removeEventListener('click', onOutside)
}
async function toggle() {
  if (open.value) return close()
  const r = root.value?.getBoundingClientRect()
  up.value = !!r && window.innerHeight - BAR_H - r.bottom < Math.min(MENU_H, 120 + 36 * state.playlists.length) && r.top > window.innerHeight - r.bottom
  open.value = true
  document.addEventListener('click', onOutside)
  loading.value = true
  holding.value = new Map()
  ticked.clear()
  try {
    const found = await api.playlistsContaining(props.kind, props.id)
    holding.value = new Map(found.map((h) => [h.playlist_id, h]))
    found.forEach((h) => ticked.add(h.playlist_id))
  } catch (err: any) {
    notify(err?.message || String(err), true)
    close()
  } finally {
    loading.value = false
  }
}
function tick(playlistId: number) {
  if (ticked.has(playlistId)) ticked.delete(playlistId)
  else ticked.add(playlistId)
}
/** A new list, ticked at once (as Spotify): it gets the song with «Hecho». */
async function create() {
  const name = newName.value.trim()
  if (!name) return
  busy.value = true
  try {
    const created = await api.createPlaylist(name)
    newName.value = ''
    await refreshPlaylists()
    ticked.add(created.id)
  } catch (err: any) {
    notify(err?.message || String(err), true)
  } finally {
    busy.value = false
  }
}

async function done() {
  if (props.kind !== 'song' && added.value.length) {
    choosing.value = true
    choices.value = null
    try {
      choices.value = props.kind === 'artist' ? await releaseChoices() : await songChoices()
    } catch (err: any) {
      notify(err?.message || String(err), true)
      choosing.value = false
    }
    return
  }
  await apply()
}
async function releaseChoices(): Promise<Choice[]> {
  const page = await api.artist(props.id)
  return page.releases
    .filter((r) => ['done', 'wanted', 'downloading', 'preview-wanted'].includes(r.status))
    .map((r) => ({ key: String(r.release_id), id: r.release_id, title: r.title, cover: r.cover, keep: true,
                   note: [fmtDate(r.date), kindLabel(r.kind)].filter(Boolean).join(' · ') }))
}
async function songChoices(): Promise<Choice[]> {
  const page = await api.album(props.id)
  return page.songs.map((s, i) => ({ key: s.isrc ? `i:${s.isrc.toUpperCase()}` : s.file ? `p:${s.file.path}` : `?${i}`,
                                     id: s.id, title: s.title, cover: null, keep: true, note: fmtTime(s.duration) }))
}

/** Adds to the lists ticked now and takes it out of those unticked (a song that comes with a release: left out). */
async function apply() {
  busy.value = true
  const into: string[] = []
  const outOf: string[] = []
  const name = (id: number) => state.playlists.find((p) => p.id === id)?.name || ''
  try {
    const out = (choices.value ?? []).filter((c) => !c.keep && !c.key.startsWith('?'))
    for (const p of added.value) {
      try {
        await api.addToPlaylist(p.id, props.kind, props.id, {
          newToo: newToo.value,
          skipReleases: props.kind === 'artist' ? out.map((c) => c.id) : [],
          exclude: props.kind === 'release' ? out.map((c) => ({ key: c.key, title: c.title })) : [],
        })
      } catch (err: any) {
        if (err?.status !== 409) throw err   // 409: it was there already
      }
      into.push(p.name)
    }
    for (const h of removed.value) {
      if (h.via === 'release' || h.via === 'artist') await api.exclude(h.playlist_id, h.key!, h.song)
      else await api.removeFromPlaylist(h.playlist_id, h.item_id)
      outOf.push(name(h.playlist_id))
    }
    const list = (names: string[]) => (names.length === 1 ? `«${names[0]}»` : `${names.length} listas`)
    notify([into.length && `Añadido a ${list(into)}`, outOf.length && `${into.length ? 'quitado' : 'Quitado'} de ${list(outOf)}`].filter(Boolean).join(' y ') + '.')
    close()
    await Promise.all([refreshPlaylists(), refreshDownloads(), into.length && props.kind === 'artist' && !props.followed ? refreshFollows() : null])
    if (into.length) emit('added')
  } catch (err: any) {
    notify(err?.message || String(err), true)
    await refreshPlaylists()
  } finally {
    busy.value = false
  }
}
onBeforeUnmount(() => document.removeEventListener('click', onOutside))
</script>
