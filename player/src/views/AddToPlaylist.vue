<template>
  <span ref="root" class="rp-add">
    <button :class="small ? 'rp-mini rp-add-mini' : 'rp-btn'" :title="title" :aria-label="title" :aria-expanded="open" @click.stop="toggle">
      <template v-if="small"><i class="rp-i rp-i-add" aria-hidden="true"></i></template><template v-else><i class="rp-i rp-i-add" aria-hidden="true"></i> Añadir a lista</template>
    </button>
    <div v-if="open && !target" class="rp-menu" role="menu" @click.stop>
      <p class="rp-menu-head rp-muted rp-small">Añadir {{ what }} a…</p>
      <button v-for="p in state.playlists" :key="p.id" class="rp-menu-item" role="menuitem" :disabled="busy" @click="pick(p.id, p.name)">
        <i class="rp-i rp-i-playlist" aria-hidden="true"></i> <span class="rp-ellipsis">{{ p.name }}</span>
      </button>
      <form class="rp-menu-new" @submit.prevent="pick(null, newName.trim())">
        <input v-model="newName" class="rp-input" placeholder="Nueva lista…" maxlength="120" aria-label="Nombre de la lista nueva" />
        <button class="rp-btn rp-small rp-primary" :disabled="!newName.trim() || busy">Crear</button>
      </form>
      <label v-if="kind === 'artist'" class="rp-menu-check">
        <input v-model="newToo" type="checkbox" /> Añadir sus temas nuevos
      </label>
      <p v-if="hint" class="rp-muted rp-tiny rp-menu-hint">{{ hint }}</p>
    </div>
    <div v-else-if="open && target" class="rp-menu rp-menu-wide" role="dialog" :aria-label="`Qué entra en «${target.name}»`" @click.stop>
      <p class="rp-menu-head rp-small"><strong>Qué entra en «{{ target.name }}»</strong></p>
      <p v-if="!choices" class="rp-muted rp-small rp-menu-hint"><span class="rp-spin"></span> Cargando…</p>
      <p v-else-if="!choices.length" class="rp-muted rp-small rp-menu-hint">No hay nada que elegir: entra entero.</p>
      <template v-else>
        <p class="rp-muted rp-tiny rp-menu-hint">Desmarca lo que no quieras en la lista.</p>
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
        <button class="rp-btn rp-small" :disabled="busy" @click="target = null">Atrás</button>
        <button class="rp-btn rp-small rp-primary" :disabled="busy || !choices || (choices.length > 0 && !choices.some((c) => c.keep))" @click="confirm">Añadir</button>
      </div>
    </div>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { ItemKind } from '../lib/api'
import { fmtTime, kindLabel, fmtDate } from '../lib/library'
import { useStore } from '../lib/store'

/** "＋ Añadir a lista" for a song, a release or an artist (Deezer ids); for the last two, what of it comes in. */
const props = withDefaults(defineProps<{ kind: ItemKind; id: number; followed?: boolean; small?: boolean }>(), { followed: true, small: false })
/** `added`: it went into a list (what it needs may be downloading now). */
const emit = defineEmits<{ added: [] }>()
const { api, state, notify, refreshPlaylists, refreshFollows, refreshDownloads } = useStore()
const root = ref<HTMLElement>()
const open = ref(false)
const busy = ref(false)
const newName = ref('')
const newToo = ref(true)

/** The playlist picked (id null: a new one, created on confirming) and what of the release or artist can be left out. */
interface Choice { key: string; id: number; title: string; cover: string | null; note: string; keep: boolean }
const target = ref<{ id: number | null; name: string } | null>(null)
const choices = ref<Choice[] | null>(null)

const what = computed(() => ({ song: 'la canción', release: 'el disco', artist: 'el artista' })[props.kind])
const title = computed(() => `Añadir ${what.value} a una lista`)
const hint = computed(() => (props.kind === 'artist' && !props.followed ? 'Aún no sigues a este artista: se empezará a seguir y se bajará su música.'
  : props.kind !== 'artist' ? 'Si aún no lo tienes, se baja (solo esto, sin seguir a nadie).' : ''))

function onOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) close()
}
function close() {
  open.value = false
  target.value = null
  document.removeEventListener('click', onOutside)
}
function toggle() {
  if (open.value) return close()
  open.value = true
  document.addEventListener('click', onOutside)
}

async function pick(id: number | null, name: string) {
  if (!name) return
  if (props.kind === 'song') return add(id, name)
  target.value = { id, name }
  choices.value = null
  try {
    choices.value = props.kind === 'artist' ? await releaseChoices() : await songChoices()
  } catch (err: any) {
    notify(err?.message || String(err), true)
    target.value = null
  }
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

async function confirm() {
  if (target.value) await add(target.value.id, target.value.name)
}
async function add(playlistId: number | null, name: string) {
  busy.value = true
  try {
    if (playlistId === null) {
      const created = await api.createPlaylist(name)
      playlistId = created.id
      newName.value = ''
      if (target.value) target.value.id = created.id
    }
    const out = (choices.value ?? []).filter((c) => !c.keep && !c.key.startsWith('?'))
    await api.addToPlaylist(playlistId, props.kind, props.id, {
      newToo: newToo.value,
      skipReleases: props.kind === 'artist' ? out.map((c) => c.id) : [],
      exclude: props.kind === 'release' ? out.map((c) => ({ key: c.key, title: c.title })) : [],
    })
    notify(`Añadido a «${name}»${out.length ? ` (sin ${out.length})` : ''}.`)
    close()
    await Promise.all([refreshPlaylists(), refreshDownloads(), props.kind === 'artist' && !props.followed ? refreshFollows() : null])
    emit('added')
  } catch (err: any) {
    notify(err?.status === 409 ? `Ya estaba en «${name}».` : err?.message || String(err), err?.status !== 409)
  } finally {
    busy.value = false
  }
}
onBeforeUnmount(() => document.removeEventListener('click', onOutside))
</script>
