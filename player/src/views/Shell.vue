<template>
  <div class="rp">
    <aside class="rp-side" aria-label="Tu biblioteca">
      <div class="rp-brand">
        <span class="rp-brand-mark" aria-hidden="true"><i class="rp-i rp-i-music" aria-hidden="true"></i></span>
        <strong>El Reproductor</strong>
      </div>
      <nav class="rp-nav">
        <a href="#" :class="{ on: view.v === 'home' }" @click.prevent="go({ v: 'home' })"><span class="rp-ni"><i class="rp-i rp-i-home" aria-hidden="true"></i></span> Inicio</a>
        <a href="#" :class="{ on: view.v === 'search' }" @click.prevent="go({ v: 'search' })"><span class="rp-ni"><i class="rp-i rp-i-search" aria-hidden="true"></i></span> Buscar</a>
        <a href="#" :class="{ on: view.v === 'downloads' }" @click.prevent="go({ v: 'downloads' })">
          <span class="rp-ni"><span v-if="downloading" class="rp-spin"></span><template v-else><i class="rp-i rp-i-download" aria-hidden="true"></i></template></span> Descargas
          <span v-if="state.downloads.active.length" class="rp-count" :title="`${state.downloads.active.length} bajando o en espera`">{{ state.downloads.active.length }}</span>
          <span v-else-if="state.downloads.failed.length" class="rp-count rp-count-bad" title="Con fallos">{{ state.downloads.failed.length }}</span>
        </a>
        <a v-if="soundliftState.url || soundliftState.unplaced" href="#" :class="{ on: view.v === 'soundlift' }" @click.prevent="go({ v: 'soundlift' })">
          <span class="rp-ni"><span v-if="soundliftState.active" class="rp-spin"></span><template v-else><i class="rp-i rp-i-music" aria-hidden="true"></i></template></span> Descargar música
          <span v-if="soundliftState.review + soundliftState.unplaced" class="rp-count rp-count-alert"
                :title="`${soundliftState.review + soundliftState.unplaced} ${soundliftState.review + soundliftState.unplaced === 1 ? 'canción necesita' : 'canciones necesitan'} que decidas`">
            <i class="rp-i rp-i-bell" aria-hidden="true"></i>{{ soundliftState.review + soundliftState.unplaced }}
          </span>
        </a>
        <a href="#" :class="{ on: view.v === 'spotify' }" @click.prevent="go({ v: 'spotify' })"><span class="rp-ni"><i class="rp-i rp-i-up" aria-hidden="true"></i></span> Traer tu Spotify</a>
      </nav>
      <div class="rp-lib">
        <div class="rp-libfilter">
          <i class="rp-i rp-i-search" aria-hidden="true"></i>
          <input v-model="filter" class="rp-libfilter-input" type="search" placeholder="Filtrar tu biblioteca" aria-label="Filtrar artistas, canciones, listas y carpetas"
                 @keydown.esc="filter = ''" />
          <button v-if="filter" class="rp-libfilter-clear" title="Quitar el filtro" aria-label="Quitar el filtro" @click="filter = ''"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
        </div>
        <p v-if="filtering && !shownArtists.length && !shownSongs.length && !shownLists.length && !shownFolders.length" class="rp-muted rp-small rp-libnone">
          <template v-if="songsLoading"><span class="rp-spin"></span> Buscando…</template><template v-else>Nada con «{{ filter.trim() }}».</template></p>
        <div v-if="!filtering || shownArtists.length" class="rp-libh rp-libh-row">
          <button class="rp-group" :aria-expanded="isOpen('artists')" @click="toggleGroup('artists')">
            <span class="rp-chev" :class="{ open: isOpen('artists') }"><i class="rp-i rp-i-chev" aria-hidden="true"></i></span> Artistas <small class="rp-muted">{{ filtering ? shownArtists.length : artists.length }}</small>
          </button>
        </div>
        <template v-if="isOpen('artists') && (!filtering || shownArtists.length)">
        <p v-if="!state.loaded" class="rp-muted rp-small"><span class="rp-spin"></span> Cargando…</p>
        <p v-else-if="!artists.length && !filtering" class="rp-muted rp-small">
          Aún no tienes a nadie. <a href="#" @click.prevent="go({ v: 'search' })">Busca un artista</a>: síguelo, o baja solo un disco o una canción.
        </p>
        <ul v-else class="rp-artists">
          <li v-for="a in shownArtists" :key="a.artist_id">
            <a href="#" :class="{ on: view.v === 'artist' && view.id === a.artist_id }" @click.prevent="go({ v: 'artist', id: a.artist_id })">
              <img v-if="a.picture" :src="a.picture" alt="" class="rp-avatar" loading="lazy" />
              <span v-else class="rp-avatar rp-avatar-none"><i class="rp-i rp-i-artist" aria-hidden="true"></i></span>
              <span class="rp-aname">
                <span class="rp-ellipsis">{{ a.name }}</span>
                <small v-if="a.note" class="rp-muted rp-ellipsis">{{ a.note }}</small>
              </span>
            </a>
          </li>
        </ul>
        </template>
        <template v-if="filtering && shownSongs.length">
          <div class="rp-libh rp-libh-row"><span class="rp-group">Canciones <small class="rp-muted">{{ matchedSongs.length }}</small></span></div>
          <ul class="rp-artists">
            <li v-for="s in shownSongs" :key="s.key">
              <a href="#" :class="{ on: nowPlaying?.key === s.key }" :title="`Reproducir «${s.title}»`" @click.prevent="play(matchedSongs, s, false)">
                <img v-if="s.cover" :src="s.cover" alt="" class="rp-avatar rp-avatar-song" loading="lazy" />
                <span v-else class="rp-avatar rp-avatar-song rp-avatar-none"><i class="rp-i rp-i-music" aria-hidden="true"></i></span>
                <span class="rp-aname">
                  <span class="rp-ellipsis">{{ s.title }}</span>
                  <small class="rp-muted rp-ellipsis">{{ [s.artist, s.album].filter(Boolean).join(' · ') }}</small>
                </span>
              </a>
            </li>
          </ul>
          <p v-if="matchedSongs.length > shownSongs.length" class="rp-muted rp-small">Y {{ matchedSongs.length - shownSongs.length }} más: afina la búsqueda.</p>
        </template>
        <div v-if="!filtering || shownLists.length" class="rp-libh rp-libh-row">
          <button class="rp-group" :aria-expanded="isOpen('lists')" @click="toggleGroup('lists')">
            <span class="rp-chev" :class="{ open: isOpen('lists') }"><i class="rp-i rp-i-chev" aria-hidden="true"></i></span> Listas <small class="rp-muted">{{ filtering ? shownLists.length : state.playlists.length }}</small>
          </button>
          <button class="rp-mini" title="Nueva lista" @click="newPlaylist"><i class="rp-i rp-i-add" aria-hidden="true"></i></button>
        </div>
        <template v-if="isOpen('lists') && (!filtering || shownLists.length)">
        <form v-if="creating" class="rp-newlist" @submit.prevent="createPlaylist">
          <input ref="newListInput" v-model="newListName" class="rp-input" placeholder="Nombre de la lista" maxlength="120" @keydown.esc="creating = false" />
        </form>
        <p v-if="state.loaded && !state.playlists.length && !creating && !filtering" class="rp-muted rp-small">
          Aún no tienes listas. Crea una con ＋ y añade canciones, discos o artistas.
        </p>
        <ul v-else class="rp-artists">
          <li v-for="p in shownLists" :key="p.id">
            <a href="#" :class="{ on: view.v === 'playlist' && view.id === p.id }" @click.prevent="go({ v: 'playlist', id: p.id })">
              <span class="rp-avatar rp-avatar-folder"><i class="rp-i rp-i-playlist" aria-hidden="true"></i></span>
              <span class="rp-aname">
                <span class="rp-ellipsis">{{ p.name }}</span>
                <small class="rp-muted rp-ellipsis">{{ p.items }} {{ p.items === 1 ? 'elemento' : 'elementos' }}</small>
              </span>
            </a>
          </li>
        </ul>
        </template>
        <div v-if="!filtering || shownFolders.length" class="rp-libh rp-libh-row">
          <button class="rp-group" :aria-expanded="isOpen('folders')" @click="toggleGroup('folders')">
            <span class="rp-chev" :class="{ open: isOpen('folders') }"><i class="rp-i rp-i-chev" aria-hidden="true"></i></span> Carpetas <small class="rp-muted">{{ filtering ? shownFolders.length : folders.length }}</small>
          </button>
        </div>
        <ul v-if="isOpen('folders') && (!filtering || shownFolders.length)" class="rp-artists rp-folders">
          <li v-for="f in shownFolders" :key="f.path">
            <a href="#" :class="{ on: view.v === 'folder' && view.path === f.path }" @click.prevent="go({ v: 'folder', path: f.path })">
              <span class="rp-avatar rp-avatar-folder"><i class="rp-i rp-i-folder" aria-hidden="true"></i></span><span class="rp-ellipsis">{{ f.name }}</span>
            </a>
          </li>
          <li v-if="!filtering">
            <a href="#" :class="{ on: view.v === 'folder' && view.path === rootPath }" @click.prevent="go({ v: 'folder', path: rootPath })">
              <span class="rp-avatar rp-avatar-folder"><i class="rp-i rp-i-folder" aria-hidden="true"></i></span><span class="rp-ellipsis">Toda «{{ musicRoot }}»</span>
            </a>
          </li>
        </ul>
      </div>
      <a v-if="back" href="#" class="rp-back" :title="back.title || back.label" @click.prevent="back.go()"><i class="rp-i rp-i-back" aria-hidden="true"></i> {{ back.label }}</a>
    </aside>

    <main ref="mainEl" class="rp-main">
      <p v-if="state.error" class="rp-banner rp-banner-error">
        {{ state.error }} <button class="rp-btn rp-small" @click="connect()">Reintentar</button>
      </p>
      <HomeView v-if="view.v === 'home'" />
      <SearchView v-else-if="view.v === 'search'" :q="view.q || ''" :tab="view.tab" />
      <ArtistView v-else-if="view.v === 'artist'" :key="`a${view.id}`" :id="view.id" />
      <ReleaseView v-else-if="view.v === 'release'" :key="`r${view.id}`" :id="view.id" />
      <FolderView v-else-if="view.v === 'folder'" :key="`f${view.path}`" :path="view.path" :play-file="props.playFile" />
      <PlaylistView v-else-if="view.v === 'playlist'" :key="`p${view.id}`" :id="view.id" />
      <DeezerPlaylistView v-else-if="view.v === 'dzlist'" :key="`d${view.id}`" :id="view.id" />
      <DownloadsView v-else-if="view.v === 'downloads'" />
      <SoundliftView v-else-if="view.v === 'soundlift'" />
      <SpotifyView v-else-if="view.v === 'spotify'" />
    </main>

    <PlayerBar class="rp-bar" />
    <div v-if="removing" class="rp-modal" @click.self="!removing.busy && answerRemove(false)">
      <div class="rp-dialog" role="dialog" :aria-label="removing.title">
        <h2 class="rp-h2">{{ removing.title }}</h2>
        <p>
          {{ removing.paths.length === 1 ? 'Se borra 1 canción' : `Se borran ${removing.paths.length} canciones` }} de tu nube.
          Van a la papelera de {{ cloudName }}, desde donde se pueden recuperar.
        </p>
        <p v-if="removing.detail" class="rp-muted">{{ removing.detail }}</p>
        <p v-if="removing.busy" class="rp-muted rp-small"><span class="rp-spin"></span> Borrando {{ removing.done }} de {{ removing.paths.length }}…</p>
        <div class="rp-rules-actions">
          <button class="rp-btn" :disabled="removing.busy" @click="answerRemove(false)">Cancelar</button>
          <button class="rp-btn rp-danger-solid" :disabled="removing.busy" @click="answerRemove(true)">Borrar</button>
        </div>
      </div>
    </div>
    <div v-if="toast.text" :class="['rp-toast', { 'rp-toast-error': toast.error }]" role="status">{{ toast.text }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from 'vue'
import type { Api } from '../lib/api'
import { Soundlift, soundliftState } from '../lib/soundlift'
import { isAudioName, isBusy, libraryArtists, releaseSongs, type Song } from '../lib/library'
import { nowPlaying, play, setResolver, toggle } from '../lib/player'
import { STORE, createState, type Files, type RemoveRequest, type View } from '../lib/store'
import '../lib/ui.css'
import HomeView from './HomeView.vue'
import SearchView from './SearchView.vue'
import ArtistView from './ArtistView.vue'
import ReleaseView from './ReleaseView.vue'
import FolderView from './FolderView.vue'
import PlaylistView from './PlaylistView.vue'
import DeezerPlaylistView from './DeezerPlaylistView.vue'
import DownloadsView from './DownloadsView.vue'
import PlayerBar from './PlayerBar.vue'
import SoundliftView from './SoundliftView.vue'
import SpotifyView from './SpotifyView.vue'

/**
 * El Reproductor: the artists you follow and their music, always up to date in your cloud.
 * Following an artist asks the El Reproductor service to download their releases (through
 * soundlift, into Música/Artistas); the player plays straight from the cloud.
 *
 * Each platform hosts it: it gives the API, soundlift, how to reach the files and where the app is
 * (`view`, changed with `navigate`; the web keeps it in the route's query so the back button works).
 * `playFile`: a song to play once its folder (the view) shows it.
 */
const props = defineProps<{
  api: Api
  sl: Soundlift
  files: Files
  view: View
  navigate: (view: View, replace?: boolean) => void
  musicRoot?: string
  cloudName?: string
  /** a link out of the app (the web: back to the cloud's files) */
  back?: { label: string; title?: string; go: () => void }
  playFile?: string
}>()

const api = props.api
const sl = props.sl
const files = props.files
const musicRoot = props.musicRoot || 'Música'
const cloudName = props.cloudName || 'tu nube'
const rootPath = `/${musicRoot}`
const state = createState()
const mainEl = ref<HTMLElement>()
const toast = reactive({ text: '', error: false })
let toastTimer: any = null

const view = computed<View>(() => props.view)
function go(next: View, replace = false) { props.navigate(next, replace) }
watch(() => JSON.stringify(view.value), () => mainEl.value?.scrollTo({ top: 0 }))

function notify(text: string, error = false) {
  toast.text = text
  toast.error = error
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.text = '' }, error ? 7000 : 3500)
}

async function refreshFollows() {
  try {
    state.follows = await api.follows()
    state.loaded = true
  } catch (err: any) {
    state.error = `No se pudo hablar con El Reproductor: ${err?.message || err}`
  }
}
/** What is coming and what finished: the Descargas counter, and a word when something is ready. */
const downloading = computed(() => state.downloads.active.some((r) => r.status === 'downloading'))
let lastActive = new Set<number>()
/** How many songs the reorganisation left to place (counted in the bell of «Descargar música»). */
async function refreshUnplaced() {
  if (!state.connected) return
  try { soundliftState.unplaced = (await api.unplaced()).length } catch (_) {}
}
async function refreshDownloads() {
  try {
    const d = await api.downloads()
    const finished = d.recent.filter((r) => lastActive.has(r.release_id))
    const before = JSON.stringify(state.downloads.active.map((r) => [r.release_id, r.status]))
    const wasIdle = !state.downloads.active.length
    state.downloads = d
    lastActive = new Set(d.active.map((r) => r.release_id))
    if (wasIdle && d.active.length) schedule()   // something started: follow it every few seconds from now
    if (finished.length === 1) notify(`Ya está: «${finished[0].title}».`)
    else if (finished.length > 1) notify(`Ya están ${finished.length} descargas.`)
    // Something started or ended: the counts on every page move too.
    if (before !== JSON.stringify(d.active.map((r) => [r.release_id, r.status]))) { refreshFollows(); refreshAlbums() }
  } catch (_) { /* the follows' error already shows */ }
}
/** What there is of artists not followed (releases and songs downloaded by hand, or that were here
 * already): with the followed ones, the library's artists. */
async function refreshAlbums() {
  try {
    state.albums = (await api.releases({ lite: true })).filter((r) => !r.followed && ['done', 'downloading', 'wanted'].includes(r.status))
  } catch (_) { /* the follows' error already shows */ }
}
const artists = computed(() => libraryArtists(state.follows, state.albums))
async function refreshPlaylists() {
  try { state.playlists = await api.playlists() } catch (_) { /* the follows' error already shows */ }
}
/** The library's groups fold; all folded at first, and each stays as you leave it. */
const GROUPS_KEY = 'reproductor.groups'
const groups = reactive({ artists: false, lists: false, folders: false })
try { Object.assign(groups, JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}')) } catch (_) {}
// ---- the sidebar's filter: artists, playlists and folders by name; groups with matches open ----
const filter = ref('')
const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const filtering = computed(() => filter.value.trim().length > 0)
const matches = (name: string) => plain(name).includes(plain(filter.value.trim()))
const shownArtists = computed(() => (filtering.value ? artists.value.filter((a) => matches(a.name)) : artists.value))
const shownLists = computed(() => (filtering.value ? state.playlists.filter((p) => matches(p.name)) : state.playlists))
const shownFolders = computed(() => (filtering.value ? folders.value.filter((f) => matches(f.name)) : folders.value))
const isOpen = (key: keyof typeof groups) => filtering.value || groups[key]

// Songs too: every downloaded one, loaded the first time the filter is used (and again after new downloads).
const librarySongs = ref<Song[] | null>(null)
const songsLoading = ref(false)
async function loadSongs() {
  if (songsLoading.value) return
  songsLoading.value = true
  try {
    const done = await api.releases({ status: 'done' })
    const seen = new Set<string>()
    librarySongs.value = done.flatMap((r) => releaseSongs(r)).filter((s) => !seen.has(s.key) && !!seen.add(s.key))
  } catch (_) { /* the filter just finds no songs */ } finally { songsLoading.value = false }
}
watch(filtering, (on) => { if (on && !librarySongs.value) loadSongs() })
watch(() => state.downloads.recent.length, () => { librarySongs.value = null; if (filtering.value) loadSongs() })
const matchedSongs = computed(() => {
  if (!filtering.value || !librarySongs.value) return []
  const words = plain(filter.value.trim()).split(/\s+/)
  return librarySongs.value.filter((s) => { const text = plain(`${s.title} ${s.artist} ${s.album}`); return words.every((w) => text.includes(w)) })
    .sort((a, b) => Number(!matches(a.title)) - Number(!matches(b.title)))   // title matches first
})
const shownSongs = computed(() => matchedSongs.value.slice(0, 30))

function toggleGroup(key: keyof typeof groups, open?: boolean) {
  groups[key] = open ?? !groups[key]
  try { localStorage.setItem(GROUPS_KEY, JSON.stringify(groups)) } catch (_) {}
}
const creating = ref(false)
const newListName = ref('')
const newListInput = ref<HTMLInputElement>()
function newPlaylist() {
  toggleGroup('lists', true)
  creating.value = !creating.value
  if (creating.value) nextTick(() => newListInput.value?.focus())
}
async function createPlaylist() {
  const name = newListName.value.trim()
  if (!name) { creating.value = false; return }
  try {
    const created = await api.createPlaylist(name)
    newListName.value = ''
    creating.value = false
    await refreshPlaylists()
    go({ v: 'playlist', id: created.id })
  } catch (err: any) { notify(err?.message || String(err), true) }
}
async function connect() {
  state.error = ''
  try {
    await api.ensureConnected()
    state.connected = true
  } catch (err: any) {
    state.error = `No se pudo conectar El Reproductor con tu nube: ${err?.message || err}`
    return
  }
  await Promise.all([refreshFollows(), refreshPlaylists(), refreshDownloads(), refreshAlbums(), refreshUnplaced()])
}

// ---- deleting music: to the cloud's trash bin, then empty folders, then the service forgets it ----
interface Removing extends RemoveRequest { paths: string[]; busy: boolean; done: number; resolve: (ok: boolean) => void }
const removing = ref<Removing | null>(null)
function remove(req: RemoveRequest): Promise<boolean> {
  const paths = [...new Set(req.paths.filter((p): p is string => !!p))]
  if (!paths.length) {
    notify('No hay nada de eso en tu nube.', true)
    return Promise.resolve(false)
  }
  return new Promise((resolve) => { removing.value = { ...req, paths, busy: false, done: 0, resolve } })
}
async function answerRemove(ok: boolean) {
  const r = removing.value
  if (!r || r.busy) return
  if (!ok) {
    removing.value = null
    r.resolve(false)
    return
  }
  r.busy = true
  const gone: string[] = []
  let failed = 0
  for (const path of r.paths) {
    try {
      await files.remove(path)
      gone.push(path)
    } catch (err: any) {
      if (err?.status === 404) gone.push(path)  // already gone
      else failed++
    }
    r.done++
  }
  await pruneFolders(gone)
  try {
    if (gone.length) await api.forget(gone)
    if (r.unfollow && !failed) await api.unfollow(r.unfollow)
  } catch (err: any) {
    notify(err?.message || String(err), true)
  }
  notify(failed ? `Borradas ${gone.length}; ${failed} no se pudieron borrar.` : gone.length === 1 ? 'Borrada 1 canción.' : `Borradas ${gone.length} canciones.`, failed > 0)
  removing.value = null
  r.resolve(gone.length > 0)
  await Promise.all([refreshFollows(), refreshDownloads(), refreshAlbums(), refreshPlaylists(), loadFolders()])
}
/** Folders left with no songs (a cover at most) go too, up to the artist's; never the music root's own folders. */
async function pruneFolders(paths: string[]) {
  const keepDepth = rootPath.split('/').length + 1          // /Música/Artistas stays
  const dirs = [...new Set(paths.map((p) => p.slice(0, p.lastIndexOf('/'))))].sort((a, b) => b.length - a.length)
  const done = new Set<string>()
  for (let dir of dirs) {
    while (dir.startsWith(`${rootPath}/`) && dir.split('/').length > keepDepth && !done.has(dir)) {
      done.add(dir)
      try {
        const found = await files.list(dir)
        if (found.folders.length || found.files.some((f) => isAudioName(f.name))) break
        await files.remove(dir)
      } catch (_) {
        break
      }
      dir = dir.slice(0, dir.lastIndexOf('/'))
    }
  }
}

provide(STORE, { api, musicRoot, cloudName, files, state, refreshFollows, refreshPlaylists, refreshDownloads, go, notify, sl, remove })

// ---- folders of the music root (the music that is not by followed artist yet) ----
const folders = ref<{ path: string; name: string }[]>([])
async function loadFolders() {
  try {
    const found = await files.list(rootPath)
    folders.value = found.folders
      .filter((f) => f.name !== 'Artistas')
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  } catch (_) { folders.value = [] }
}

// ---- player: cloud path → playable URL ----
setResolver((song) => files.play(song))

// ---- keep an eye on downloads while something is going on ----
let poll: any = null
function schedule() {
  clearTimeout(poll)
  const busy = state.downloads.active.length > 0 || isBusy(state.follows)
  poll = setTimeout(async () => {
    if (document.visibilityState === 'visible' && state.connected) await refreshDownloads()
    if (document.visibilityState === 'visible' && isBusy(state.follows)) await refreshFollows()
    if (document.visibilityState === 'visible' && view.value.v !== 'soundlift') await Promise.all([sl.refreshCounts(), refreshUnplaced()])
    schedule()
  }, busy ? 4000 : 30000)
}

function onKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)) return
  if (e.code === 'Space') { e.preventDefault(); toggle() }
}

onMounted(() => {
  connect()
  loadFolders()
  sl.refreshCounts()
  schedule()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  clearTimeout(poll)
  window.removeEventListener('keydown', onKey)
})
</script>
