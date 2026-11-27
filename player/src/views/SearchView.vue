<template>
  <section class="rp-page">
    <header class="rp-page-head">
      <input ref="input" v-model="query" class="rp-search" type="search" placeholder="¿Qué quieres escuchar?" aria-label="Buscar"
             @keydown.enter="runNow" />
    </header>
    <nav class="rp-tabs" role="tablist">
      <button v-for="t in TABS" :key="t.value" role="tab" :aria-selected="tab === t.value" :class="['rp-chip', { on: tab === t.value }]"
              @click="setTab(tab === t.value && t.value !== 'all' ? 'all' : t.value)">{{ t.label }}</button>
    </nav>
    <p v-if="error" class="rp-banner rp-banner-error">{{ error }}</p>
    <p v-else-if="busy" class="rp-muted"><span class="rp-spin"></span> Buscando…</p>
    <p v-else-if="query.trim() && searched && !count" class="rp-muted">Nada con «{{ query.trim() }}» en el catálogo.</p>
    <p v-else-if="!query.trim()" class="rp-muted">Busca en el catálogo de Deezer. Al seguir un artista, o añadir algo suyo a una lista, se baja su música a {{ where }}.</p>

    <h2 v-if="tab === 'all' && artists.length" class="rp-h2 rp-search-sec">Artistas <a v-if="artists.length > LIMIT.artists" href="#" class="rp-small rp-muted" @click.prevent="setTab('artists')">Ver todos</a></h2>
    <ul v-if="(tab === 'all' || tab === 'artists') && artists.length" class="rp-results">
      <li v-for="a in cut(artists, 'artists')" :key="a.id">
        <a href="#" class="rp-result" @click.prevent="go({ v: 'artist', id: a.id })">
          <img v-if="a.picture" :src="a.picture" alt="" loading="lazy" class="rp-result-pic" />
          <span v-else class="rp-result-pic rp-artist-none"><i class="rp-i rp-i-artist" aria-hidden="true"></i></span>
          <span class="rp-result-text">
            <strong class="rp-ellipsis">{{ a.name }}</strong>
            <small class="rp-muted">{{ [fmtFans(a.fans), a.albums ? `${a.albums} lanzamientos` : ''].filter(Boolean).join(' · ') }}</small>
          </span>
        </a>
        <span v-if="followed(a.id)" class="rp-badge rp-badge-done">Siguiendo</span>
        <button v-else class="rp-btn rp-small" :disabled="following === a.id" title="Seguir y bajar toda su discografía" @click="quickFollow(a)">
          <span v-if="following === a.id" class="rp-spin"></span> Seguir
        </button>
      </li>
    </ul>

    <h2 v-if="tab === 'all' && tracks.length" class="rp-h2 rp-search-sec">Canciones <a v-if="tracks.length > LIMIT.tracks" href="#" class="rp-small rp-muted" @click.prevent="setTab('tracks')">Ver todas</a></h2>
    <TrackList v-if="(tab === 'all' || tab === 'tracks') && tracks.length" :hits="cut(tracks, 'tracks')" show-artist show-album @changed="refreshTracks" />

    <h2 v-if="tab === 'all' && albums.length" class="rp-h2 rp-search-sec">Discos <a v-if="albums.length > LIMIT.albums" href="#" class="rp-small rp-muted" @click.prevent="setTab('albums')">Ver todos</a></h2>
    <ul v-if="(tab === 'all' || tab === 'albums') && albums.length" class="rp-results">
      <li v-for="a in cut(albums, 'albums')" :key="a.id">
        <a href="#" class="rp-result" @click.prevent="openAlbum(a)">
          <img v-if="a.cover" :src="a.cover" alt="" loading="lazy" class="rp-result-pic rp-square" />
          <span v-else class="rp-result-pic rp-square rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
          <span class="rp-result-text">
            <strong class="rp-ellipsis">{{ a.title }}</strong>
            <small class="rp-muted rp-ellipsis">{{ [a.artist_name, fmtDate(a.date), kindLabel(a.kind)].filter(Boolean).join(' · ') }}</small>
          </span>
        </a>
        <span v-if="a.status && a.status !== 'skipped'" :class="['rp-badge', `rp-badge-${a.status}`]">{{ statusLabel({ status: a.status, reason: '' }).text }}</span>
        <button v-else class="rp-btn rp-small" :disabled="downloading === a.id" title="Bajar este disco (sin seguir al artista)" @click="downloadAlbum(a)">
          <span v-if="downloading === a.id" class="rp-spin"></span> <i class="rp-i rp-i-cloud-down" aria-hidden="true"></i> Bajar
        </button>
        <AddToPlaylist kind="release" :id="a.id" small />
      </li>
    </ul>

    <h2 v-if="tab === 'all' && lists.length" class="rp-h2 rp-search-sec">Listas <a v-if="lists.length > LIMIT.playlists" href="#" class="rp-small rp-muted" @click.prevent="setTab('playlists')">Ver todas</a></h2>
    <ul v-if="(tab === 'all' || tab === 'playlists') && lists.length" class="rp-results">
      <li v-for="l in cut(lists, 'playlists')" :key="l.id">
        <a href="#" class="rp-result" @click.prevent="go({ v: 'dzlist', id: l.id })">
          <img v-if="l.cover" :src="l.cover" alt="" loading="lazy" class="rp-result-pic rp-square" />
          <span v-else class="rp-result-pic rp-square rp-cover-none"><i class="rp-i rp-i-playlist" aria-hidden="true"></i></span>
          <span class="rp-result-text">
            <strong class="rp-ellipsis">{{ l.title }}</strong>
            <small class="rp-muted rp-ellipsis">{{ [l.owner && `de ${l.owner}`, l.tracks ? `${l.tracks} canciones` : ''].filter(Boolean).join(' · ') }}</small>
          </span>
        </a>
      </li>
    </ul>

  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { AlbumHit, Artist, DeezerPlaylistHit, TrackHit } from '../lib/api'
import { DEFAULT_RULES, fmtFans, kindLabel, statusLabel, fmtDate } from '../lib/library'
import { useStore } from '../lib/store'
import AddToPlaylist from './AddToPlaylist.vue'
import TrackList from './TrackList.vue'
import { isPhone } from '../lib/phone'

type Tab = 'all' | 'artists' | 'albums' | 'playlists' | 'tracks'
const TABS: { value: Tab; label: string }[] = [
  { value: 'all', label: 'Todo' }, { value: 'artists', label: 'Artistas' }, { value: 'albums', label: 'Discos' }, { value: 'playlists', label: 'Listas' }, { value: 'tracks', label: 'Canciones' }
]

const props = defineProps<{ q: string; tab?: string }>()
const { api, state, go, notify, refreshFollows, where } = useStore()
const input = ref<HTMLInputElement>()
const query = ref(props.q)
const tab = ref<Tab>((TABS.some((t) => t.value === props.tab) ? props.tab : 'all') as Tab)
// In «Todo», a few of each kind (with «Ver todos» to see the rest).
const LIMIT = { artists: 6, tracks: 8, albums: 6, playlists: 6 }
const cut = <T,>(items: T[], kind: keyof typeof LIMIT): T[] => (tab.value === 'all' ? items.slice(0, LIMIT[kind]) : items)
const artists = ref<Artist[]>([])
const albums = ref<AlbumHit[]>([])
const tracks = ref<TrackHit[]>([])
const lists = ref<DeezerPlaylistHit[]>([])
const downloading = ref<number | null>(null)
const busy = ref(false)
const searched = ref('')
const error = ref('')
const following = ref<number | null>(null)
let timer: any = null
let seq = 0

const followed = (id: number) => state.follows.some((f) => f.artist_id === id)
const count = computed(() => (tab.value === 'all'
  ? artists.value.length + albums.value.length + lists.value.length + tracks.value.length
  : ({ artists: artists.value, albums: albums.value, playlists: lists.value, tracks: tracks.value })[tab.value].length))

async function run() {
  const q = query.value.trim()
  // Keep the words in the URL (back from an artist lands on the same results), without a history entry.
  go({ v: 'search', ...(q ? { q } : {}), ...(tab.value !== 'all' ? { tab: tab.value } : {}) }, true)
  if (!q) { artists.value = []; albums.value = []; lists.value = []; tracks.value = []; searched.value = ''; return }
  if (searched.value === `${tab.value}:${q}`) return
  const mine = ++seq
  busy.value = true
  error.value = ''
  try {
    if (tab.value === 'all') {
      const got = await Promise.allSettled([api.search(q), api.searchTracks(q), api.searchAlbums(q), api.searchPlaylists(q)])
      if (mine !== seq) return
      const failed = got.find((g): g is PromiseRejectedResult => g.status === 'rejected')
      if (got.every((g) => g.status === 'rejected')) throw failed!.reason
      const ok = <T,>(g: PromiseSettledResult<T>, empty: T) => (g.status === 'fulfilled' ? g.value : empty)
      artists.value = ok(got[0], [] as Artist[]); tracks.value = ok(got[1], [] as TrackHit[])
      albums.value = ok(got[2], [] as AlbumHit[]); lists.value = ok(got[3], [] as DeezerPlaylistHit[])
    } else if (tab.value === 'artists') artists.value = await api.search(q)
    else if (tab.value === 'albums') albums.value = await api.searchAlbums(q)
    else if (tab.value === 'playlists') lists.value = await api.searchPlaylists(q)
    else tracks.value = await api.searchTracks(q)
    if (mine === seq) searched.value = `${tab.value}:${q}`
  } catch (err: any) {
    if (mine === seq) error.value = `No se pudo buscar: ${err?.message || err}`
  } finally {
    if (mine === seq) busy.value = false
  }
}
function runNow() { clearTimeout(timer); run() }
function setTab(t: Tab) { tab.value = t; runNow() }
watch(query, () => { clearTimeout(timer); timer = setTimeout(run, 350) })

async function quickFollow(a: Artist) {
  following.value = a.id
  try {
    await api.follow(a.id, DEFAULT_RULES)
    await refreshFollows()
    notify(`Sigues a ${a.name}: se va a bajar su discografía.`)
  } catch (err: any) {
    notify(err?.message || String(err), true)
  } finally {
    following.value = null
  }
}
function openAlbum(a: AlbumHit) { go({ v: 'release', id: a.id }) }
async function downloadAlbum(a: AlbumHit) {
  downloading.value = a.id
  try {
    const r = await api.choose(a.id, 'download')
    a.status = r.status
    notify(`Bajando «${a.title}».`)
  } catch (err: any) { notify(err?.message || String(err), true) } finally { downloading.value = null }
}
async function refreshTracks() {
  const q = query.value.trim()
  if (q) tracks.value = await api.searchTracks(q).catch(() => tracks.value)
}

onMounted(() => {
  if (!isPhone.value) input.value?.focus()   // on a phone the keyboard would cover the tabs: it opens on touching the box
  if (query.value.trim()) run()
})
</script>
