<template>
  <section class="rp-page">
    <header class="rp-page-head">
      <h1 class="rp-h1">Descargar música</h1>
    </header>
    <p class="rp-muted rp-small rp-sl-intro">
      Lo que está bajando soundlift (lo que pides aquí y lo que pegas en ♪ Descargar música de {{ cloudName }}) y las canciones que necesitan que decidas.
    </p>
    <section v-if="unplaced.length" class="rp-section">
      <div class="rp-sl-head">
        <h2 class="rp-h2">Por colocar <small class="rp-muted">{{ unplaced.length }}</small></h2>
      </div>
      <p class="rp-muted rp-small">
        Canciones que ya tenías y que Deezer no reconoció al ordenar tu música: siguen en su carpeta de antes.
        Di cuál es y se mueve a su sitio en Artistas (las listas que la tienen la siguen), o déjala donde está.
      </p>
      <ul class="rp-sl-list">
        <li v-for="u in unplaced" :key="u.path" class="rp-sl-item">
          <div class="rp-sl-row">
            <span class="rp-sl-main">
              <strong class="rp-ellipsis">{{ u.title }}</strong>
              <small class="rp-muted rp-ellipsis">{{ [u.artist.replace(/ • /g, ', '), fmtSec(u.duration)].filter(Boolean).join(' · ') }}</small>
              <small class="rp-muted rp-ellipsis" :title="u.path">En {{ folderOf(u.path) }}</small>
            </span>
          </div>
          <div class="rp-sl-actions">
            <button class="rp-btn rp-small" @click="listenFile(u)"><i class="rp-i rp-i-play" aria-hidden="true"></i> Escuchar</button>
            <button class="rp-btn rp-small rp-primary" :disabled="!!placing[u.path]" :aria-expanded="!!found[u.path]" @click="toggleFind(u)">
              {{ found[u.path] ? 'Ocultar' : 'Buscar en Deezer' }}
            </button>
            <button class="rp-btn rp-small" :disabled="!!placing[u.path]" title="No moverla: se queda en su carpeta y deja de salir aquí" @click="placeAs(u, null)">Dejar donde está</button>
          </div>
          <p v-if="problems[u.path]" class="rp-small rp-sl-bad">{{ problems[u.path] }}</p>
          <div v-if="found[u.path]" class="rp-sl-find">
            <form class="rp-sl-search" @submit.prevent="find(u)">
              <input v-model="queries[u.path]" class="rp-input" aria-label="Buscar en Deezer" />
              <button class="rp-btn rp-small" :disabled="searching[u.path]"><span v-if="searching[u.path]" class="rp-spin"></span> Buscar</button>
            </form>
            <ul class="rp-sl-cands">
              <li v-if="!searching[u.path] && !found[u.path]!.length" class="rp-muted rp-small">Nada en Deezer con eso: prueba con otras palabras.</li>
              <li v-for="t in found[u.path]" :key="t.id">
                <img v-if="t.cover" :src="t.cover" alt="" class="rp-sl-cover" loading="lazy" />
                <span class="rp-sl-main">
                  <span class="rp-ellipsis">{{ t.title }}</span>
                  <small class="rp-muted rp-ellipsis">{{ [t.artist_name, t.album_title, fmtSec(t.duration)].filter(Boolean).join(' · ') }}</small>
                </span>
                <button class="rp-btn rp-small" :disabled="listening.loading === `dz:${t.id}`" :title="'Escuchar 30 segundos'" @click="listen(`dz:${t.id}`, () => api.preview(t.id))">
                  <span v-if="listening.loading === `dz:${t.id}`" class="rp-spin"></span>
                  <i v-else :class="['rp-i', listening.id === `dz:${t.id}` && listening.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i> 30 s
                </button>
                <a :href="t.link || `https://www.deezer.com/track/${t.id}`" target="_blank" rel="noopener" class="rp-btn rp-small" title="Abrirla en Deezer">Deezer ↗</a>
                <a :href="ytMusicSearch(t)"target="_blank" rel="noopener" class="rp-btn rp-small" title="Buscarla en YouTube Music para oírla entera">YT Music ↗</a>
                <button class="rp-btn rp-small rp-primary" :disabled="!!placing[u.path]" @click="placeAs(u, t)">
                  <span v-if="placing[u.path] === t.id" class="rp-spin"></span> Es esta
                </button>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </section>

    <p v-if="!sl.enabled" class="rp-banner">soundlift no está configurado en El Reproductor.</p>
    <p v-else-if="error" class="rp-banner rp-banner-error">{{ error }} <button class="rp-btn rp-small" @click="load">Reintentar</button></p>
    <p v-else-if="!loaded" class="rp-muted"><span class="rp-spin"></span> Cargando…</p>
    <template v-else>
      <section class="rp-section">
        <div class="rp-sl-head">
          <h2 class="rp-h2">Por revisar <small class="rp-muted">{{ review.length }}</small></h2>
          <button v-if="review.length" class="rp-btn rp-small" title="Quitarlas todas de la lista; los archivos se quedan como están" @click="dismissAll">Descartar todas</button>
        </div>
        <p v-if="!review.length" class="rp-muted rp-small">Nada que revisar.</p>
        <template v-else>
          <p class="rp-muted rp-small">Coincidencias con poca confianza o canciones que no se pudieron bajar: escúchalas, confírmalas o elige otra versión.</p>
          <ul class="rp-sl-list">
            <li v-for="t in review" :key="t.spotify_id" class="rp-sl-item">
              <div class="rp-sl-row">
                <span class="rp-sl-main">
                  <strong class="rp-ellipsis">{{ t.title }}</strong>
                  <small class="rp-muted rp-ellipsis">{{ [t.artists.join(', '), t.album, fmtMs(t.duration_ms)].filter(Boolean).join(' · ') }}</small>
                </span>
                <span v-if="t.score != null" class="rp-badge" :title="'Confianza del emparejamiento'">confianza {{ Math.round(t.score) }}</span>
              </div>
              <p :class="['rp-small', t.status === 'failed' ? 'rp-sl-bad' : 'rp-muted']">
                {{ t.status === 'failed' ? (t.failure_reason || 'No se pudo bajar') : (t.failure_reason || 'Coincidencia con poca confianza') }}
              </p>
              <div class="rp-sl-actions">
                <button v-if="t.status !== 'failed'" class="rp-btn rp-small" :disabled="listening.loading === t.spotify_id" @click="listen(t.spotify_id, () => sl.audio(t.spotify_id))">
                  <span v-if="listening.loading === t.spotify_id" class="rp-spin"></span>
                  <i v-else :class="['rp-i', listening.id === t.spotify_id && listening.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i>
                  {{ listening.id === t.spotify_id && listening.playing ? 'Pausar' : 'Escuchar' }}
                </button>
                <button v-if="t.status !== 'failed'" class="rp-btn rp-small rp-primary" :disabled="!!busy[t.spotify_id]" @click="accept(t)">Suena bien, quedármela</button>
                <button class="rp-btn rp-small" :disabled="!!busy[t.spotify_id]" :aria-expanded="!!candidates[t.spotify_id]" @click="toggleCandidates(t)">
                  <span v-if="busy[t.spotify_id] === 'searching'" class="rp-spin"></span>
                  {{ busy[t.spotify_id] === 'searching' ? 'Buscando…' : candidates[t.spotify_id] ? 'Ocultar opciones' : 'Ver otras opciones' }}
                </button>
                <button class="rp-btn rp-small" :disabled="!!busy[t.spotify_id]" title="Quitarla de la lista; el archivo se queda como está" @click="dismiss(t)">Descartar</button>
              </div>
              <p v-if="problems[t.spotify_id]" class="rp-small rp-sl-bad">{{ problems[t.spotify_id] }}</p>
              <ul v-if="candidates[t.spotify_id]" class="rp-sl-cands">
                <li v-if="!candidates[t.spotify_id]!.length" class="rp-muted rp-small">Ninguna fuente ofreció otras opciones.</li>
                <li v-for="c in candidates[t.spotify_id]" :key="c.source + c.external_id" :class="{ 'rp-sl-weak': c.rejected }">
                  <span class="rp-badge" :title="c.reasons.join('\n')">{{ Math.round(c.score) }}</span>
                  <span class="rp-sl-main">
                    <span class="rp-ellipsis">{{ c.title }}</span>
                    <small class="rp-muted rp-ellipsis">
                      {{ [c.artists.join(', '), c.album, fmtMs(c.duration_ms), SOURCES[c.source] || c.source, c.is_lossless ? 'sin pérdida' : '', c.is_official ? 'oficial' : ''].filter(Boolean).join(' · ') }}
                    </small>
                    <small v-if="c.tried" class="rp-muted">{{ c.tried.outcome === 'ok' ? 'Es la versión actual' : `Ya probada: ${c.tried.detail}` }}</small>
                  </span>
                  <a :href="c.url" target="_blank" rel="noopener" class="rp-btn rp-small" :title="`Escucharla en ${SOURCES[c.source] || c.source}`">Abrir</a>
                  <button class="rp-btn rp-small" :disabled="!!busy[t.spotify_id]" :title="c.rejected ? 'Poca confianza: se baja igualmente si la eliges' : ''" @click="choose(t, c)">
                    <span v-if="busy[t.spotify_id] === c.external_id" class="rp-spin"></span> {{ busy[t.spotify_id] === c.external_id ? 'Bajando…' : 'Usar esta' }}
                  </button>
                </li>
              </ul>
            </li>
          </ul>
        </template>
      </section>

      <section class="rp-section">
        <div class="rp-sl-head">
          <h2 class="rp-h2">Progreso</h2>
          <button v-if="jobs.some(finished)" class="rp-btn rp-small" title="Quitar de la lista lo que ya terminó" @click="clearFinished">Limpiar</button>
        </div>
        <p v-if="!jobs.length" class="rp-muted rp-small">Nada en soundlift ahora mismo.</p>
        <ul v-else class="rp-dl">
          <li v-for="j in jobs" :key="j.id">
            <span class="rp-dl-main">
              <strong class="rp-ellipsis">{{ jobTitle(j) }}</strong>
              <small class="rp-muted rp-ellipsis">{{ jobLine(j) }}</small>
              <span v-if="ACTIVE.includes(j.status)" class="rp-dl-bar"><i :style="{ width: (j.total ? Math.round((100 * j.processed) / j.total) : 4) + '%' }"></i></span>
            </span>
            <span v-if="ACTIVE.includes(j.status)" class="rp-dl-state"><span class="rp-spin"></span> {{ j.total ? `${j.processed} de ${j.total}` : 'empezando…' }}</span>
            <span v-else :class="['rp-badge', j.status === 'done' ? 'rp-badge-done' : j.status === 'failed' ? 'rp-badge-failed' : '']">{{ STATUS[j.status] || j.status }}</span>
            <button v-if="ACTIVE.includes(j.status)" class="rp-mini" title="Cancelar" aria-label="Cancelar" :disabled="j.cancelling" @click="cancel(j)">
              <i class="rp-i rp-i-close" aria-hidden="true"></i>
            </button>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { TrackHit, Unplaced } from '../lib/api'
import { play, player, toggle } from '../lib/player'
import { ACTIVE, soundliftState, type SlCandidate, type SlJob, type SlReview } from '../lib/soundlift'
import { useStore } from '../lib/store'

const { api, sl, state, notify, refreshDownloads, cloudName } = useStore()
const jobs = ref<SlJob[]>([])
const review = ref<SlReview[]>([])
const loaded = ref(false)
const error = ref('')
const busy = reactive<Record<string, string | undefined>>({})
const problems = reactive<Record<string, string | undefined>>({})
const candidates = reactive<Record<string, SlCandidate[] | undefined>>({})

const STATUS: Record<string, string> = { done: 'Terminado', failed: 'Falló', cancelled: 'Cancelado' }
const SOURCES: Record<string, string> = { ytmusic: 'YouTube Music', youtube: 'YouTube', deezer: 'Deezer', soundcloud: 'SoundCloud' }
const finished = (j: SlJob) => !ACTIVE.includes(j.status)
const fmtMs = (ms?: number | null) => (ms == null ? '' : `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, '0')}`)

/** El Reproductor's own downloads are Deezer links: named after the release they are. */
function jobTitle(j: SlJob): string {
  const m = j.url.match(/deezer\.com\/(?:[a-z]{2}\/)?(album|track)\/(\d+)/)
  if (m) {
    const id = m[1] === 'album' ? Number(m[2]) : -Number(m[2])
    const d = state.downloads
    const r = [...d.active, ...d.recent, ...d.failed].find((x) => x.release_id === id)
    if (r) return [r.artist_name, r.title].filter(Boolean).join(' – ')
    return m[1] === 'album' ? 'Disco de Deezer' : 'Canción de Deezer'
  }
  return (j.name && j.name !== 'Artistas' ? j.name : '') || j.collection || j.url
}
function jobLine(j: SlJob): string {
  if (j.error) return j.error
  const s = j.summary || {}
  const parts = ACTIVE.includes(j.status) ? [j.cancelling ? 'cancelando…' : 'bajando']
    : [s.done ? `${s.done} bajadas` : '', s.review ? `${s.review} por revisar` : '', s.failed ? `${s.failed} sin bajar` : '']
  return parts.filter(Boolean).join(' · ') || (j.total ? `${j.total} canciones` : '')
}

// ---- songs the reorganisation could not place ----
const unplaced = ref<Unplaced[]>([])
const found = reactive<Record<string, TrackHit[] | undefined>>({})
const queries = reactive<Record<string, string>>({})
const searching = reactive<Record<string, boolean>>({})
const placing = reactive<Record<string, number | true | undefined>>({})
const fmtSec = (s: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}` : '')
const folderOf = (path: string) => path.split('/').slice(1, -1).join(' / ')
/** Deezer only plays 30 s: a YouTube Music search (where the songs usually come from) lets you hear it whole, though it may turn up another version. */
const ytMusicSearch = (t: TrackHit) => `https://music.youtube.com/search?q=${encodeURIComponent(`${t.artist_name} ${t.title}`)}`
async function loadUnplaced() {
  try {
    unplaced.value = await api.unplaced()
    soundliftState.unplaced = unplaced.value.length
  } catch (_) {}
}
function listenFile(u: Unplaced) {
  stopListening()
  play([{ key: u.path, path: u.path, title: u.title, artist: u.artist, album: '', cover: null, duration: u.duration }], null, false)
}
async function toggleFind(u: Unplaced) {
  if (found[u.path]) { found[u.path] = undefined; return }
  queries[u.path] = queries[u.path] || u.query
  found[u.path] = []
  await find(u)
}
async function find(u: Unplaced) {
  searching[u.path] = true
  problems[u.path] = undefined
  try {
    found[u.path] = await api.unplacedCandidates(u.path, queries[u.path] !== u.query ? queries[u.path] : undefined)
  } catch (err: any) { problems[u.path] = err?.message || String(err) }
  searching[u.path] = false
}
async function placeAs(u: Unplaced, t: TrackHit | null) {
  if (listening.id.startsWith('dz:')) stopListening()
  const at = unplaced.value.indexOf(u)
  unplaced.value = unplaced.value.filter((x) => x.path !== u.path)
  soundliftState.unplaced = unplaced.value.length
  problems[u.path] = undefined
  try {
    const r = await api.place(u.path, t ? t.id : null)
    found[u.path] = undefined
    notify(r.kept ? `«${u.title}» se queda donde está.` : r.was_there ? `Ya la tenías en su sitio: esta copia va a la papelera.` : `«${t!.title}» ya está en Artistas.`)
  } catch (err: any) {
    unplaced.value.splice(Math.max(0, at), 0, u)
    soundliftState.unplaced = unplaced.value.length
    problems[u.path] = `No se pudo: ${err?.message || err}`
  }
}

async function load() {
  try {
    const [j, r] = await Promise.all([sl.jobs(), sl.review()])
    jobs.value = j
    review.value = r
    soundliftState.review = r.length
    soundliftState.active = j.filter((x) => ACTIVE.includes(x.status)).length
    error.value = ''
  } catch (err: any) {
    error.value = `No se pudo hablar con soundlift: ${err?.message || err}`
  } finally {
    loaded.value = true
  }
}
async function afterChange(t: SlReview) {
  candidates[t.spotify_id] = undefined
  if (listening.id === t.spotify_id) stopListening()
  await load()
}
async function accept(t: SlReview) {
  busy[t.spotify_id] = 'accept'
  problems[t.spotify_id] = undefined
  try { await sl.accept(t.spotify_id) } catch (err: any) { problems[t.spotify_id] = err?.message || String(err) }
  busy[t.spotify_id] = undefined
  await afterChange(t)
}
async function dismiss(t: SlReview) {
  review.value = review.value.filter((x) => x.spotify_id !== t.spotify_id)
  soundliftState.review = review.value.length
  try { await sl.dismiss(t.spotify_id) } catch (err: any) { notify(err?.message || String(err), true); await load() }
}
async function dismissAll() {
  review.value = []
  soundliftState.review = 0
  try { await sl.dismissAll() } catch (err: any) { notify(err?.message || String(err), true); await load() }
}
async function toggleCandidates(t: SlReview) {
  if (candidates[t.spotify_id]) { candidates[t.spotify_id] = undefined; return }
  busy[t.spotify_id] = 'searching'
  problems[t.spotify_id] = undefined
  try { candidates[t.spotify_id] = await sl.candidates(t.spotify_id) } catch (err: any) { problems[t.spotify_id] = err?.message || String(err) }
  busy[t.spotify_id] = undefined
}
async function choose(t: SlReview, c: SlCandidate) {
  busy[t.spotify_id] = c.external_id
  problems[t.spotify_id] = undefined
  try {
    const r = await sl.rechoose(t.spotify_id, c)
    if (r.status === 'failed') problems[t.spotify_id] = r.detail || 'No se pudo bajar esa versión'
    else notify(`«${t.title}»: usando la versión elegida.`)
  } catch (err: any) { problems[t.spotify_id] = err?.message || String(err) }
  busy[t.spotify_id] = undefined
  await afterChange(t)
}
async function cancel(j: SlJob) {
  j.cancelling = true
  try { await sl.cancel(j.id); await Promise.all([load(), refreshDownloads()]) } catch (err: any) { notify(err?.message || String(err), true); j.cancelling = false }
}
async function clearFinished() {
  jobs.value = jobs.value.filter((j) => !finished(j))
  try { await sl.dismissFinished() } catch (_) {}
}

// ---- listening to what soundlift got, before keeping it (the player pauses meanwhile) ----
const listening = reactive({ id: '', playing: false, loading: '' })
let audio: HTMLAudioElement | null = null
let blobUrl = ''
async function listen(id: string, load: () => Promise<Blob>) {
  if (listening.id === id && audio) {
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
    return
  }
  stopListening()
  listening.loading = id
  try {
    const blob = await load()
    if (player.playing) toggle()
    blobUrl = URL.createObjectURL(blob)
    audio = new Audio(blobUrl)
    audio.volume = player.volume          // as loud as the player, not the browser's full volume
    audio.addEventListener('play', () => { listening.playing = true })
    audio.addEventListener('pause', () => { listening.playing = false })
    audio.addEventListener('ended', () => { listening.playing = false })
    listening.id = id
    await audio.play()
  } catch (err: any) {
    notify(err?.message || String(err), true)
  } finally {
    listening.loading = ''
  }
}
watch(() => player.volume, (v) => { if (audio) audio.volume = v })
function stopListening() {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null }
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = '' }
  listening.id = ''
  listening.playing = false
}

// While something is under way, look again every few seconds.
let timer: any = null
function schedule() {
  timer = setTimeout(async () => {
    if (document.visibilityState === 'visible') await load()
    schedule()
  }, jobs.value.some((j) => ACTIVE.includes(j.status)) ? 3000 : 20000)
}
onMounted(async () => {
  loadUnplaced()
  await sl.findUrl()
  if (sl.enabled) { await load(); schedule() } else loaded.value = true
})
onBeforeUnmount(() => { clearTimeout(timer); stopListening() })
</script>
