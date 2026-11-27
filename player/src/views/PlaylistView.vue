<template>
  <section class="rp-page">
    <p v-if="error" class="rp-banner rp-banner-error">{{ error }}</p>
    <p v-else-if="!pl" class="rp-muted"><span class="rp-spin"></span> Cargando la lista…</p>
    <template v-else>
      <header class="rp-hero">
        <div class="rp-hero-pic rp-mosaic">
          <template v-if="covers.length >= 4"><img v-for="c in covers.slice(0, 4)" :key="c" :src="c" alt="" /></template>
          <img v-else-if="covers.length" :src="covers[0]" alt="" class="rp-mosaic-one" />
          <span v-else class="rp-cover-none"><i class="rp-i rp-i-playlist" aria-hidden="true"></i></span>
        </div>
        <div class="rp-hero-text">
          <span class="rp-muted rp-small">Lista</span>
          <form v-if="renaming" class="rp-rename" @submit.prevent="rename">
            <input ref="nameInput" v-model="newName" class="rp-input rp-rename-input" maxlength="120" aria-label="Nombre de la lista" @keydown.esc="renaming = false" />
            <button class="rp-btn rp-small rp-primary" :disabled="!newName.trim()">Guardar</button>
            <button type="button" class="rp-btn rp-small" @click="renaming = false">Cancelar</button>
          </form>
          <h1 v-else class="rp-h1 rp-big" title="Cambiar el nombre" @dblclick="startRename">{{ pl.name }}</h1>
          <span class="rp-muted rp-small">
            {{ pl.songs.length }} {{ pl.songs.length === 1 ? 'canción' : 'canciones' }}<template v-if="total"> · {{ fmtLength(total) }}</template>
            · <span :title="pl.nd_error || ''">{{ pl.nd_error ? 'No se pudo pasar a Navidrome' : pl.in_navidrome ? 'También en Navidrome' : 'Pasando a Navidrome…' }}</span>
          </span>
          <div class="rp-hero-actions">
            <button v-if="songs.length" class="rp-btn rp-primary rp-round-btn" title="Reproducir" @click="play(songs, null, false)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
            <button v-if="songs.length" class="rp-act" title="Aleatorio" aria-label="Reproducir en orden aleatorio" @click="play(songs, null, true)"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i></button>
            <OfflineButton :paths="songs.map((s) => s.path)" :list-id="pl.id" />
            <ActionMenu :items="menu" />
          </div>
        </div>
      </header>

      <div v-if="!pl.entries.length && !files" class="rp-empty">
        <span class="rp-empty-icon"><i class="rp-i rp-i-playlist" aria-hidden="true"></i></span>
        <p>Lista vacía. Añade canciones, discos o artistas con <strong>Añadir a lista</strong> desde
          <a href="#" @click.prevent="go({ v: 'search' })">Buscar</a> o desde sus páginas. Lo que aún no tengas se bajará solo.</p>
      </div>

      <section v-if="pl.entries.length || files" class="rp-section">
        <h2 class="rp-h2">Qué incluye <small class="rp-muted">{{ pl.entries.length + files }}</small></h2>
        <p v-if="files" class="rp-muted rp-small">{{ files }} {{ files === 1 ? 'canción' : 'canciones' }} de la antigua carpeta-lista (están abajo, en Canciones).</p>
        <ol class="rp-entries">
          <li v-for="(e, i) in pl.entries" :key="e.id">
            <img v-if="e.cover" :src="e.cover" alt="" :class="['rp-entry-pic', { 'rp-round': e.kind === 'artist' }]" loading="lazy" />
            <span v-else class="rp-entry-pic rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
            <span class="rp-entry-text">
              <a href="#" class="rp-ellipsis" @click.prevent="openEntry(e)"><strong>{{ e.title }}</strong></a>
              <small class="rp-muted rp-ellipsis">{{ KIND[e.kind] }}<template v-if="e.subtitle && e.kind !== 'artist'"> · {{ e.subtitle }}</template></small>
            </span>
            <span v-if="e.pending" class="rp-badge rp-badge-wanted" title="Se está bajando o se bajará pronto">{{ entryState(e) }}</span>
            <label v-if="e.kind === 'artist'" class="rp-entry-new" title="Que entre también lo que saque después de añadirlo">
              <input type="checkbox" :checked="e.new_too" @change="setNewToo(e, ($event.target as HTMLInputElement).checked)" /> Añadir sus temas nuevos
            </label>
            <button v-if="e.kind === 'artist'" class="rp-btn rp-small" :aria-expanded="choosing === e.id" @click="chooseReleases(e)">
              Elegir discos<template v-if="e.skip_releases.length"> ({{ e.skip_releases.length }} fuera)</template>
            </button>
            <span class="rp-entry-actions">
              <button class="rp-mini" title="Subir" :disabled="i === 0" @click="move(i, -1)"><i class="rp-i rp-i-up" aria-hidden="true"></i></button>
              <button class="rp-mini" title="Bajar" :disabled="i === pl.entries.length - 1" @click="move(i, 1)"><i class="rp-i rp-i-down" aria-hidden="true"></i></button>
              <button class="rp-mini" title="Quitar de la lista" @click="removeEntry(e)"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
            </span>
            <div v-if="choosing === e.id" class="rp-entry-releases">
              <p v-if="!artistReleases" class="rp-muted rp-small"><span class="rp-spin"></span> Cargando sus discos…</p>
              <p v-else-if="!artistReleases.length" class="rp-muted rp-small">Aún no hay nada suyo en {{ where }}.</p>
              <template v-else>
                <p class="rp-muted rp-small">
                  Desmarca lo que no quieras en la lista.<template v-if="e.new_too"> Lo que saque a partir de ahora entrará solo.</template>
                </p>
                <ul>
                  <li v-for="r in artistReleases" :key="r.release_id">
                    <label class="rp-check">
                      <input type="checkbox" :checked="!e.skip_releases.includes(r.release_id)" @change="toggleRelease(e, r.release_id, ($event.target as HTMLInputElement).checked)" />
                      <img v-if="r.cover" :src="r.cover" alt="" loading="lazy" />
                      <span class="rp-ellipsis">{{ r.title }}</span>
                      <small class="rp-muted">{{ [fmtDate(r.date), kindLabel(r.kind), r.status === 'done' ? '' : 'por bajar'].filter(Boolean).join(' · ') }}</small>
                    </label>
                  </li>
                </ul>
              </template>
            </div>
          </li>
        </ol>
      </section>

      <section v-if="pl.songs.length || pendingSongs.length" class="rp-section">
        <h2 class="rp-h2">Canciones</h2>
        <ol class="rp-tracks">
          <li v-for="(s, i) in songs" :key="s.key" :class="{ on: nowPlaying?.key === s.key }" @dblclick="play(songs, s)">
            <button class="rp-tplay" @click="play(songs, s)"><span class="rp-tnum">{{ i + 1 }}</span><span class="rp-ticon"><i :class="['rp-i', nowPlaying?.key === s.key && player.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i></span></button>
            <span class="rp-tinfo"><span class="rp-ellipsis" @click="phone && play(songs, s)">{{ s.title }}</span><small class="rp-muted rp-ellipsis">{{ s.artist }} · {{ s.album }}</small></span>
            <span class="rp-tright">
              <span class="rp-muted rp-small rp-tdur">{{ fmtTime(s.duration) }}</span>
              <button class="rp-mini rp-hover" title="Quitar esta canción de la lista" @click="dropSong(pl.songs[i])"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
              <button v-if="phone" class="rp-mini rp-tmore" aria-label="Más opciones" @click.stop="toggleRow"><i class="rp-i rp-i-more" aria-hidden="true"></i></button>
            </span>
          </li>
          <li v-for="p in pendingSongs" :key="'p' + p.entry.id" class="off rp-pending-song">
            <span class="rp-tplay rp-tnum"><span v-if="p.dl?.status === 'downloading'" class="rp-spin"></span><i v-else class="rp-i rp-i-cloud-down" aria-hidden="true"></i></span>
            <span class="rp-tinfo">
              <span class="rp-ellipsis">{{ p.entry.title }}</span>
              <small class="rp-muted rp-ellipsis">{{ p.entry.subtitle }}</small>
              <span v-if="p.state.pct !== null" class="rp-dl-bar"><i :style="{ width: p.state.pct + '%' }"></i></span>
            </span>
            <span class="rp-tright"><span class="rp-badge rp-badge-wanted">{{ p.state.text || 'por bajar' }}</span></span>
          </li>
        </ol>
      </section>

      <details v-if="pl.excluded.length" class="rp-section rp-excluded">
        <summary class="rp-muted">{{ pl.excluded.length }} {{ pl.excluded.length === 1 ? 'canción quitada' : 'canciones quitadas' }} a mano</summary>
        <ul>
          <li v-for="x in pl.excluded" :key="x.key"><span class="rp-ellipsis">{{ x.title || x.key }}</span>
            <button class="rp-btn rp-small" @click="include(x.key)">Volver a poner</button></li>
        </ul>
      </details>
    </template>

    <div v-if="askDelete" class="rp-modal" @click.self="askDelete = false">
      <div class="rp-dialog" role="dialog" aria-label="Borrar lista">
        <h2 class="rp-h2">¿Borrar «{{ pl?.name }}»?</h2>
        <p>Se borra la lista (también en Navidrome). La música se queda en {{ where }}.</p>
        <div class="rp-rules-actions">
          <button class="rp-btn" @click="askDelete = false">Cancelar</button>
          <button class="rp-btn rp-primary" @click="remove">Borrar</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import ActionMenu, { type MenuAction } from './ActionMenu.vue'
import OfflineButton, { keepList } from './OfflineButton.vue'
import { isPhone as phone, toggleRow } from '../lib/phone'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Playlist, PlaylistEntry, PlaylistSong, Release } from '../lib/api'
import { downloadState, fmtTime, isBusy, kindLabel, playlistSongs, fmtDate } from '../lib/library'
import { nowPlaying, play, player } from '../lib/player'
import { useStore } from '../lib/store'

const KIND = { song: 'Canción', release: 'Disco', artist: 'Artista', file: 'Archivo' }
const props = defineProps<{ id: number }>()
const { api, state, go, notify, refreshPlaylists, where, offline } = useStore()
const pl = ref<Playlist | null>(null)
const error = ref('')
const renaming = ref(false)
const newName = ref('')
const nameInput = ref<HTMLInputElement>()
const askDelete = ref(false)

const songs = computed(() => playlistSongs(pl.value?.songs || []))
/** the header's «⋯»: keep it on the device, rename it, delete it */
const menu = computed<(MenuAction | 'sep')[]>(() => {
  const id = pl.value?.id || 0
  return [
    { label: 'Mantener guardada', note: 'Lo que se añada se guarda solo en este equipo', icon: 'rp-i-save', if: !!offline && songs.value.length > 0,
      checked: !!offline?.isKept(id), run: () => keepList(offline!, id, songs.value.map((s) => s.path), !offline!.isKept(id), notify) },
    { label: 'Cambiar nombre', icon: 'rp-i-edit', run: startRename },
    'sep',
    { label: 'Borrar lista', icon: 'rp-i-delete', danger: true, run: () => { askDelete.value = true } }
  ]
})
const total = computed(() => (pl.value?.songs || []).reduce((n, s) => n + (s.duration || 0), 0))
const files = computed(() => pl.value?.file_entries || 0)
const covers = computed(() => [...new Set((pl.value?.entries || []).map((e) => e.cover).filter(Boolean) as string[])])
const fmtLength = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`)

async function load() {
  try {
    pl.value = await api.playlist(props.id)
    error.value = ''
  } catch (err: any) {
    error.value = err?.status === 404 ? 'Esta lista ya no existe.' : `No se pudo cargar la lista: ${err?.message || err}`
  }
}
async function act(fn: () => Promise<Playlist>, done?: string) {
  try {
    pl.value = await fn()
    if (done) notify(done)
    refreshPlaylists()
  } catch (err: any) { notify(err?.message || String(err), true) }
}
function startRename() {
  newName.value = pl.value?.name || ''
  renaming.value = true
  nextTick(() => nameInput.value?.select())
}
async function rename() {
  await act(() => api.renamePlaylist(props.id, newName.value.trim()))
  renaming.value = false
}
async function remove() {
  askDelete.value = false
  try {
    await api.deletePlaylist(props.id)
    await refreshPlaylists()
    notify('Lista borrada.')
    go({ v: 'home' })
  } catch (err: any) { notify(err?.message || String(err), true) }
}
function move(i: number, delta: number) {
  const ids = pl.value!.entries.map((e) => e.id)
  const [id] = ids.splice(i, 1)
  ids.splice(i + delta, 0, id)
  act(() => api.reorder(props.id, ids))
}
const removeEntry = (e: PlaylistEntry) => act(() => api.removeFromPlaylist(props.id, e.id), `Quitado: ${e.title}.`)
const setNewToo = (e: PlaylistEntry, on: boolean) => act(() => api.changeItem(props.id, e.id, { new_too: on }))

/** An artist's releases in the cloud, to leave some out of the playlist. */
const choosing = ref<number | null>(null)
const artistReleases = ref<Release[] | null>(null)
async function chooseReleases(e: PlaylistEntry) {
  if (choosing.value === e.id) { choosing.value = null; return }
  choosing.value = e.id
  artistReleases.value = null
  try {
    const all = await api.releases({ artist: e.deezer_id, lite: true })
    artistReleases.value = all.filter((r) => ['done', 'wanted', 'downloading'].includes(r.status))
  } catch (err: any) { notify(err?.message || String(err), true); choosing.value = null }
}
function toggleRelease(e: PlaylistEntry, releaseId: number, keep: boolean) {
  const skip = new Set(e.skip_releases)
  if (keep) skip.delete(releaseId)
  else skip.add(releaseId)
  act(() => api.changeItem(props.id, e.id, { skip_releases: [...skip] }))
}
const include = (key: string) => act(() => api.include(props.id, key))
/** A song added on its own (or a file of an old folder playlist) leaves with its entry; one that came
 * with a release or an artist is left out. */
function dropSong(s: PlaylistSong) {
  const entry = pl.value!.entries.find((e) => e.id === s.item_id)
  if (!entry) act(() => api.removeFromPlaylist(props.id, s.item_id), `Quitada: ${s.title}.`)
  else if (entry.kind === 'song') removeEntry(entry)
  else act(() => api.exclude(props.id, s.key, `${s.title} · ${s.artist}`), `Quitada: ${s.title}.`)
}
function openEntry(e: PlaylistEntry) {
  if (e.kind === 'artist') go({ v: 'artist', id: e.deezer_id })
  else if (e.release_id) go({ v: 'release', id: e.release_id })
}

// ---- what is still on its way: songs added that are not in the cloud yet, with their download ----
/** The download that brings an entry: the song on its own, or the album it is on. */
function downloadOf(e: PlaylistEntry): Release | undefined {
  const active = state.downloads.active
  if (e.kind === 'song') {
    return active.find((r) => r.release_id === -e.deezer_id || r.track_id === e.deezer_id) || active.find((r) => !!e.release_id && r.release_id === e.release_id)
  }
  if (e.kind === 'release') return active.find((r) => r.release_id === e.deezer_id)
  return undefined
}
function entryState(e: PlaylistEntry) {
  const dl = downloadOf(e)
  return (dl && downloadState(dl).text) || 'por bajar'
}
const pendingSongs = computed(() => (pl.value?.entries || []).filter((e) => e.kind === 'song' && e.pending).map((entry) => {
  const dl = downloadOf(entry)
  return { entry, dl, state: dl ? downloadState(dl) : { pct: null as number | null, text: '' } }
}))

// While what it needs is being downloaded, the songs arrive: reload as the downloads move.
const counts = computed(() => JSON.stringify(state.follows.map((f) => f.counts)))
watch(counts, () => { if (pl.value?.entries.some((e) => e.pending) || isBusy(state.follows)) load() })
const arriving = computed(() => state.downloads.active.map((r) => r.release_id).join())
watch(arriving, () => { if (pl.value?.entries.some((e) => e.pending)) load() })
onMounted(load)
</script>
