<template>
  <section class="rp-page">
    <p v-if="error" class="rp-banner rp-banner-error">{{ error }}</p>
    <div v-else-if="!page" class="rp-artist-skel" aria-busy="true" aria-label="Cargando el artista">
      <header class="rp-hero">
        <span class="rp-hero-pic rp-round rp-skel"></span>
        <div class="rp-hero-text">
          <span class="rp-skel rp-skel-line" style="width: 70px"></span>
          <span class="rp-skel rp-skel-title"></span>
          <span class="rp-skel rp-skel-line" style="width: 160px"></span>
          <div class="rp-hero-actions"><span class="rp-skel rp-skel-btn"></span><span class="rp-skel rp-skel-btn"></span></div>
        </div>
      </header>
      <div class="rp-grid">
        <div v-for="i in 10" :key="i" class="rp-card"><span class="rp-cover rp-skel"></span><span class="rp-skel rp-skel-line"></span><span class="rp-skel rp-skel-line" style="width: 50%"></span></div>
      </div>
    </div>
    <template v-else>
      <header class="rp-hero">
        <img v-if="page.picture" :src="page.picture" alt="" class="rp-hero-pic rp-round" />
        <span v-else class="rp-hero-pic rp-round rp-artist-none"><i class="rp-i rp-i-artist" aria-hidden="true"></i></span>
        <div class="rp-hero-text">
          <span class="rp-muted rp-small">Artista</span>
          <h1 class="rp-h1 rp-big">{{ page.name }}</h1>
          <span class="rp-muted rp-small">{{ [fmtFans(page.fans), page.follow ? rulesSummary(page.follow) : ''].filter(Boolean).join(' · ') }}</span>
          <div class="rp-hero-actions">
            <button v-if="shownSongs.length" class="rp-btn rp-primary rp-round-btn" title="Reproducir todo" @click="play(shownSongs, null, false)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
            <button v-if="shownSongs.length" class="rp-act" title="Aleatorio" aria-label="Reproducir en orden aleatorio" @click="play(shownSongs, null, true)"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i></button>
            <!-- following: in one's library (it plays without downloading anything); downloading is the cloud's button -->
            <button :class="['rp-btn', 'rp-state', { on: followed }]"
                    :title="followed ? 'Lo sigues: está en tu biblioteca. Pulsa para dejar de seguirlo' : 'Seguir: a tu biblioteca, sin descargar nada'"
                    @click="toggleFollow">{{ followed ? 'Siguiendo' : 'Seguir' }}</button>
            <button :class="['rp-act', { on: !!page.follow }]" :aria-expanded="editing" :aria-label="page.follow ? 'Descargando' : 'Descargar'"
                    :title="page.follow ? `Descargando: se baja lo que saque a ${where}. Pulsa para cambiar qué se baja` : `Descargar su música a ${where} y lo nuevo que saque`"
                    @click="editing = !editing"><i class="rp-i rp-i-cloud-down" aria-hidden="true"></i></button>
            <AddToPlaylist kind="artist" :id="page.id" :followed="!!page.follow" />
            <ActionMenu :items="[
              { label: 'Qué se baja…', icon: 'rp-i-settings', if: !!page.follow, run: () => { editing = true } },
              { label: 'Seleccionar discos', note: 'Para borrar varios a la vez', icon: 'rp-i-select', if: deletable.length > 1 && !selecting, run: () => { selecting = true } },
              'sep',
              { label: 'Borrar todo lo suyo', note: `De ${where}`, icon: 'rp-i-delete', danger: true, if: songs.length > 0, run: removeAll },
              { label: 'Dejar de descargar', note: 'Lo bajado se queda', icon: 'rp-i-close', danger: true, if: !!page.follow, run: () => { askUnfollow = true } }
            ]" />
          </div>
        </div>
      </header>

      <RulesEditor v-if="editing" :initial="page.follow" :busy="saving" :save-label="page.follow ? 'Guardar' : 'Descargar'"
                   @save="saveRules" @cancel="editing = false" />

      <p v-if="page.follow?.check_error" class="rp-banner rp-banner-error">La última revisión falló: {{ page.follow.check_error }}</p>
      <p v-if="pending" class="rp-muted rp-small"><span class="rp-spin"></span> Mirando sus {{ page.releases.length }} lanzamientos para ver qué se bajaría…</p>
      <p v-if="page.follow && page.follow.checked === null" class="rp-strip"><span class="rp-spin"></span> Buscando sus discos y decidiendo qué bajar…</p>
      <p v-else-if="!page.follow && !pending" class="rp-muted">
        Así quedaría si lo descargas con las opciones de siempre. Los marcados «No se bajaría» son directos, recopilatorios o sencillos que ya están en un disco.
        Sin descargarlo todo, puedes bajar solo los discos que quieras (↓ Bajar) o entrar en uno para elegir canciones.
      </p>
      <p v-if="summary" class="rp-muted rp-small">{{ summary }}</p>

      <section v-if="top.length" class="rp-section rp-top">
        <h2 class="rp-h2">Populares</h2>
        <TrackList :hits="topShown" show-album @changed="loadTop" />
        <button v-if="top.length > 5" class="rp-btn rp-small rp-top-more" @click="topAll = !topAll">{{ topAll ? 'Ver menos' : 'Ver más' }}</button>
      </section>

      <nav v-if="songs.length" class="rp-tabs" role="tablist">
        <button role="tab" :aria-selected="mode === 'releases'" :class="['rp-chip', { on: mode === 'releases' }]" @click="setMode('releases')">Discos</button>
        <button role="tab" :aria-selected="mode === 'songs'" :class="['rp-chip', { on: mode === 'songs' }]" @click="setMode('songs')">Canciones&nbsp;<small class="rp-muted">{{ songs.length }}</small></button>
      </nav>

      <section v-if="mode === 'songs' && songs.length" class="rp-section">
        <div class="rp-songs-tools">
          <input v-model="songFilter" class="rp-search rp-search-small" type="search" placeholder="Filtrar canciones o discos" aria-label="Filtrar canciones" @keydown.esc="songFilter = ''" />
          <label class="rp-small rp-muted">Ordenar por
            <select v-model="sortBy" class="rp-input rp-small" @change="saveSort">
              <option v-for="o in SORTS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
          <button class="rp-btn rp-small" :title="desc ? 'De mayor a menor' : 'De menor a mayor'" @click="desc = !desc; saveSort()">{{ desc ? '↓ Descendente' : '↑ Ascendente' }}</button>
        </div>
        <TrackList v-if="hits.length" :hits="hits" show-album show-date @changed="load" />
        <p v-else class="rp-muted">Nada con «{{ songFilter.trim() }}».</p>
      </section>

      <template v-if="mode === 'releases' || !songs.length">
      <section v-for="g in groups" :key="g.key" class="rp-section">
        <h2 class="rp-h2">{{ g.title }} <small class="rp-muted">{{ g.releases.length }}</small></h2>
        <div class="rp-grid">
          <ReleaseCard v-for="r in g.releases" :key="r.release_id" :release="r" :selecting="selecting" :selectable="selecting && isDeletable(r)"
                       :selected="picked.has(r.release_id)" @open="go({ v: 'release', id: albumOf(r) })" @play="playRelease(r)" @select="pick(r)">
            <button v-if="!page.follow && r.status.startsWith('preview')" class="rp-btn rp-small" :disabled="busy === r.release_id"
                    title="Bajar solo este disco, sin descargar todo lo del artista" @click="choose(r, 'download')"><i class="rp-i rp-i-cloud-down" aria-hidden="true"></i> Bajar</button>
            <template v-if="page.follow || !r.status.startsWith('preview')">
              <button v-if="['skipped', 'failed'].includes(r.status)" class="rp-btn rp-small" :disabled="busy === r.release_id" @click="choose(r, 'download')"><i class="rp-i rp-i-cloud-down" aria-hidden="true"></i> Bajar</button>
              <button v-if="r.status === 'wanted'" class="rp-btn rp-small" :disabled="busy === r.release_id" @click="choose(r, 'skip')">No bajar</button>
              <button v-if="r.manual && page.follow" class="rp-btn rp-small" title="Que decidan las reglas" :disabled="busy === r.release_id" @click="choose(r, 'auto')">Automático</button>
              <AddToPlaylist kind="release" :id="r.release_id" small />
            </template>
          </ReleaseCard>
        </div>
      </section>
      </template>
      <p v-if="!groups.length && page.follow?.checked" class="rp-muted">Deezer no tiene lanzamientos de este artista.</p>
      <SelectionBar v-if="selecting" :count="picked.size" :total="deletable.length" :label="picked.size === 1 ? 'disco seleccionado' : 'discos seleccionados'"
                    @all="deletable.forEach((r) => picked.add(r.release_id))" @none="picked.clear()" @cancel="stopSelecting" @delete="removePicked" />
    </template>

    <div v-if="askUnfollow" class="rp-modal" @click.self="askUnfollow = false">
      <div class="rp-dialog" role="dialog" aria-label="Dejar de descargar">
        <h2 class="rp-h2">¿Dejar de descargar a {{ page?.name }}?</h2>
        <p>Lo que ya se ha bajado se queda en {{ where }}. Lo pendiente no se bajará y sus novedades tampoco. Si lo sigues, sigue en tu biblioteca.</p>
        <div class="rp-rules-actions">
          <button class="rp-btn" @click="askUnfollow = false">Cancelar</button>
          <button class="rp-btn rp-primary" @click="unfollow">Dejar de descargar</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { isSaved, setSaved, toggleSaved } from '../lib/saved'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { ArtistPage, Release, Rules, TrackHit } from '../lib/api'
import { albumOf, fmtFans, groupReleases, heldSongs, releaseSongs, rulesSummary, playableSongs } from '../lib/library'
import { play } from '../lib/player'
import TrackList from './TrackList.vue'
import { useStore } from '../lib/store'
import ReleaseCard from './ReleaseCard.vue'
import RulesEditor from './RulesEditor.vue'
import ActionMenu from './ActionMenu.vue'
import AddToPlaylist from './AddToPlaylist.vue'
import SelectionBar from './SelectionBar.vue'

const props = defineProps<{ id: number }>()
const { api, state, go, notify, refreshFollows, remove, where, files } = useStore()
const page = ref<ArtistPage | null>(null)
const error = ref('')
const editing = ref(false)
const saving = ref(false)
const askUnfollow = ref(false)
const busy = ref<number | null>(null)

const pending = computed(() => !!page.value?.releases.some((r) => r.status === 'preview-pending'))
const groups = computed(() => groupReleases(page.value?.releases || []))
// Every downloaded song of the artist, oldest release first (as their albums came out).
const songs = computed(() => [...(page.value?.releases || [])]
  .filter((r) => r.status === 'done')
  .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  .flatMap(releaseSongs))
// ---- «Populares»: Deezer's most listened songs of theirs (5, or 10 with «Ver más») ----
const top = ref<TrackHit[]>([])
const topAll = ref(false)
const topShown = computed(() => (topAll.value ? top.value : top.value.slice(0, 5)))
let topFor = 0
async function loadTop() {
  const id = props.id
  if (topFor !== id) { top.value = []; topAll.value = false }
  topFor = id
  try {
    const got = await api.artistTop(id, 10)
    if (props.id === id) top.value = got
  } catch (_) { /* no section */ }
}
watch(() => props.id, loadTop, { immediate: true })

// ---- «Canciones»: every downloaded song of the artist in one list, sorted and filtered ----
type Mode = 'releases' | 'songs'
type Sort = 'album' | 'date' | 'title' | 'duration'
const SORTS: { value: Sort; label: string }[] = [
  { value: 'date', label: 'Fecha' }, { value: 'album', label: 'Disco' }, { value: 'title', label: 'Título' }, { value: 'duration', label: 'Duración' }
]
const PREFS = 'reproductor.artistSongs'
const prefs = (() => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') } catch (_) { return {} } })()
const mode = ref<Mode>(prefs.mode === 'songs' ? 'songs' : 'releases')
const sortBy = ref<Sort>(SORTS.some((o) => o.value === prefs.sort) ? prefs.sort : 'date')
const desc = ref<boolean>(prefs.desc ?? true)
const songFilter = ref('')
function saveSort() { try { localStorage.setItem(PREFS, JSON.stringify({ mode: mode.value, sort: sortBy.value, desc: desc.value })) } catch (_) {} }
function setMode(m: Mode) { mode.value = m; saveSort() }
const plain = (t: string) => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
function hash(t: string) { let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) || 1 }

type Row = { pos: number; date: string; album: string; hit: TrackHit & { date: string } }
/** The downloaded songs as catalogue rows (with the release's date, and their place in it, to sort by). */
// A song both on a single and on its album shows once (the album's: albums go first).
const KIND_FIRST: Record<string, number> = { album: 0, ep: 1, single: 2 }
const rows = computed<Row[]>(() => dedupe((page.value?.releases || []).filter((r) => r.status === 'done')
  .sort((a, b) => (KIND_FIRST[a.kind] ?? 3) - (KIND_FIRST[b.kind] ?? 3)).flatMap((r) =>
  (r.files || []).flatMap((f, pos) => (f.path ? [{
    pos, date: r.date || '', album: r.title,
    hit: {
      id: f.track_id || -hash(f.path), title: f.title || r.title, duration: f.duration || 0, artist_id: r.artist_id,
      artist_name: f.artist || r.artist_name || page.value?.name || '', album_id: albumOf(r) || null, album_title: r.title,
      cover: r.cover, have: 'done' as const, date: r.date || '',
      file: { path: f.path, release_id: r.release_id, title: f.title, artist: f.artist, album: r.title, cover: r.cover }
    }
  }] : [])))))
function dedupe(list: Row[]): Row[] {
  const seen = new Set<number>()
  return list.filter((x) => !seen.has(x.hit.id) && !!seen.add(x.hit.id))
}
const hits = computed(() => {
  const q = plain(songFilter.value.trim())
  const list = rows.value.filter((x) => !q || plain(x.hit.title).includes(q) || plain(x.album).includes(q))
  const cmp: Record<Sort, (a: Row, b: Row) => number> = {
    // «Disco»: by the album's name, its songs in their order
    album: (a, b) => a.album.localeCompare(b.album, 'es', { sensitivity: 'base' }) || a.date.localeCompare(b.date) || a.pos - b.pos,
    // «Fecha»: as their releases came out, songs in their order
    date: (a, b) => a.date.localeCompare(b.date) || a.album.localeCompare(b.album) || a.pos - b.pos,
    title: (a, b) => a.hit.title.localeCompare(b.hit.title, 'es', { sensitivity: 'base' }),
    duration: (a, b) => a.hit.duration - b.hit.duration
  }
  const sorted = [...list].sort(cmp[sortBy.value])
  if (desc.value) {
    // Descending flips the albums (newest first) but keeps each album's songs in their order.
    if (sortBy.value === 'date' || sortBy.value === 'album') {
      const groups: Row[][] = []
      for (const x of sorted) {
        const g = groups[groups.length - 1]
        if (g && g[0].album === x.album && g[0].date === x.date) g.push(x)
        else groups.push([x])
      }
      return groups.reverse().flat().map((x) => x.hit)
    }
    sorted.reverse()
  }
  return sorted.map((x) => x.hit)
})
// Play / shuffle in the hero: in «Canciones», what the list shows; else the whole discography one has. An app that can
// listen to what one does not have: in «Canciones» those too; else their most listened first, then what one has.
const streams = computed(() => !!files?.stream)
const shownSongs = computed(() => {
  if (mode.value === 'songs') return playableSongs(hits.value, streams.value)
  if (!streams.value) return songs.value
  const popular = playableSongs(top.value, true)
  const there = new Set(popular.map((s) => s.trackId))
  return [...popular, ...songs.value.filter((s) => !there.has(s.trackId))]
})

const summary = computed(() => {
  const rs = page.value?.releases || []
  if (!page.value?.follow || !rs.length) return ''
  const n = (s: string) => rs.filter((r) => r.status === s).length
  const parts = [[n('done'), 'bajados'], [n('downloading'), 'bajando'], [n('wanted'), 'en espera'], [n('failed'), 'con fallos'], [n('skipped'), 'que no se bajan']]
  return parts.filter(([k]) => k).map(([k, t]) => `${k} ${t}`).join(' · ')
})

// A long discography takes a while to judge: first the artist and their releases, then what following would download.
let loads = 0
async function load() {
  const mine = ++loads
  try {
    if (!page.value || page.value.id !== props.id) {
      const quick = await api.artist(props.id, true)
      if (mine !== loads) return
      page.value = quick
      error.value = ''
      if (!quick.releases.some((r) => r.status === 'preview-pending')) return
    }
    const whole = await api.artist(props.id)
    if (mine !== loads) return
    page.value = whole
    error.value = ''
  } catch (err: any) {
    if (mine !== loads) return
    error.value = err?.status === 404 ? 'Deezer no tiene este artista.' : `No se pudo cargar el artista: ${err?.message || err}`
  }
}
// ---- choosing several releases to delete them at once ----
const filesOf = (r: Release) => (r.files || []).map((f) => f.path).filter(Boolean)
const isDeletable = (r: Release) => r.status === 'done' && filesOf(r).length > 0
const deletable = computed(() => (page.value?.releases || []).filter(isDeletable))
const selecting = ref(false)
const picked = reactive(new Set<number>())
function pick(r: Release) {
  if (!isDeletable(r)) return
  if (picked.has(r.release_id)) picked.delete(r.release_id)
  else picked.add(r.release_id)
}
function stopSelecting() {
  selecting.value = false
  picked.clear()
}
async function removePicked() {
  const chosen = deletable.value.filter((r) => picked.has(r.release_id))
  const title = chosen.length === 1 ? `¿Borrar «${chosen[0].title}»?` : `¿Borrar estos ${chosen.length} discos?`
  if (await remove({ title, paths: chosen.flatMap(filesOf) })) {
    stopSelecting()
    await load()
  }
}
async function removeAll() {
  const p = page.value
  if (!p) return
  const paths = p.releases.filter((r) => r.status === 'done').flatMap((r) => (r.files || []).map((f) => f.path))
  const done = await remove({ title: `¿Borrar la música de ${p.name}?`, paths, unfollow: p.follow ? p.id : undefined,
                              detail: p.follow ? 'Además dejará de descargarse, para que no se vuelva a bajar.' : '' })
  if (done) await load()
}
// ---- following: in one's library, without downloading (saved.ts) ----
const followed = computed(() => !!page.value && isSaved('artist', page.value.id))
function toggleFollow() {
  const p = page.value
  if (!p) return
  const on = toggleSaved('artist', p.id, { name: p.name, picture: p.picture, note: 'Artista' })
  notify(on ? `Sigues a ${p.name}: está en tu biblioteca.` : `Ya no sigues a ${p.name}.`)
}
async function saveRules(rules: Rules) {
  saving.value = true
  const was = !!page.value?.follow
  try {
    if (was) await api.changeRules(props.id, rules)
    else await api.follow(props.id, rules)
    editing.value = false
    await Promise.all([refreshFollows(), load()])
    // downloading an artist also puts them in one's library
    if (!was && page.value) setSaved('artist', page.value.id, true, { name: page.value.name, picture: page.value.picture, note: 'Artista' })
    notify(was ? 'Hecho: se revisa ahora con las nuevas reglas.' : `Descargando a ${page.value?.name}: su música y lo nuevo que saque.`)
  } catch (err: any) {
    notify(err?.message || String(err), true)
  } finally {
    saving.value = false
  }
}
async function unfollow() {
  askUnfollow.value = false
  try {
    await api.unfollow(props.id)
    await Promise.all([refreshFollows(), load()])
    notify(`Ya no se descarga lo nuevo de ${page.value?.name}.`)
  } catch (err: any) { notify(err?.message || String(err), true) }
}
async function choose(r: Release, choice: 'download' | 'skip' | 'auto') {
  busy.value = r.release_id
  try {
    await api.choose(r.release_id, choice)
    await Promise.all([refreshFollows(), load()])
  } catch (err: any) { notify(err?.message || String(err), true) } finally { busy.value = null }
}
function playRelease(r: Release) {
  const list = releaseSongs(r)
  if (list.length) play(list, null, false)
}

// While its downloads move, the sidebar's counts change: follow them here too.
const counts = computed(() => JSON.stringify(state.follows.find((f) => f.artist_id === props.id) || null))
watch(counts, load)
onMounted(load)
</script>
