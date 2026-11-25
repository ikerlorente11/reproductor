<template>
  <section class="rp-page">
    <header class="rp-page-head">
      <h1 class="rp-h1">Traer tu Spotify</h1>
    </header>

    <p v-if="error" class="rp-banner rp-banner-error">{{ error }} <button class="rp-btn rp-small" @click="load">Reintentar</button></p>
    <p v-else-if="!loaded" class="rp-muted"><span class="rp-spin"></span> Cargando…</p>

    <!-- 1. Nothing yet: how to get the download, and the upload -->
    <template v-else-if="!imp || imp.status === 'applied'">
      <div v-if="imp?.applied" class="rp-sp-done">
        <h2 class="rp-h2">Tu Spotify ya está aquí</h2>
        <ul>
          <li v-if="imp.applied.playlists_created">{{ plural(imp.applied.playlists_created, 'lista nueva', 'listas nuevas') }}</li>
          <li v-if="imp.applied.playlists_updated">{{ plural(imp.applied.playlists_updated, 'lista ya importada, puesta al día', 'listas ya importadas, puestas al día') }}</li>
          <li>{{ plural(imp.applied.songs_added, 'canción añadida', 'canciones añadidas') }} a las listas: lo que no tengas se va bajando solo (míralo en <a href="#" @click.prevent="go({ v: 'downloads' })">Descargas</a>).</li>
          <li v-if="imp.applied.follows || imp.applied.already_followed">{{ plural(imp.applied.follows, 'artista seguido', 'artistas seguidos') }}<template v-if="imp.applied.already_followed"> ({{ imp.applied.already_followed }} ya los seguías: se quedan como estaban)</template></li>
          <li v-if="imp.applied.albums">{{ plural(imp.applied.albums, 'disco guardado en cola', 'discos guardados en cola') }}</li>
          <li v-if="imp.applied.albums_failed" class="rp-sl-bad">{{ plural(imp.applied.albums_failed, 'disco no se pudo pedir', 'discos no se pudieron pedir') }} a Deezer</li>
        </ul>
      </div>
      <p class="rp-sp-intro">
        Trae a El Reproductor tus listas (también las privadas), tus «Me gusta», los discos que guardaste y los artistas que sigues.
        Todo se busca en Deezer y, antes de traer nada, lo revisas aquí.
      </p>
      <ol class="rp-sp-steps">
        <li>En Spotify, ve a <a href="https://www.spotify.com/es/account/privacy/" target="_blank" rel="noopener">Privacidad de la cuenta ↗</a>,
          marca <strong>«Datos de la cuenta»</strong> (el historial ampliado no hace falta) y pide los datos.</li>
        <li>Spotify te manda un correo con el enlace en unos días. Baja el ZIP.</li>
        <li>Súbelo aquí tal cual (o, si lo prefieres, solo su <code>Playlist1.json</code> o <code>YourLibrary.json</code>).</li>
      </ol>
      <label class="rp-btn rp-primary rp-sp-upload" :class="{ 'rp-disabled': uploading }">
        <span v-if="uploading" class="rp-spin"></span>
        <i v-else class="rp-i rp-i-up" aria-hidden="true"></i>
        {{ uploading ? 'Subiendo…' : 'Subir la descarga de Spotify' }}
        <input type="file" accept=".zip,.json,application/zip,application/json" :disabled="uploading" hidden @change="upload" />
      </label>
      <p v-if="imp?.status === 'applied'" class="rp-muted rp-small">La última importación ya se aplicó. Puedes subir otra descarga más nueva: actualiza lo ya traído sin duplicarlo.</p>
    </template>

    <!-- 2. Pairing with Deezer -->
    <template v-else-if="imp.status === 'matching'">
      <p>Buscando cada canción, disco y artista en Deezer… Puedes cerrar esto: te llega un aviso al móvil cuando esté.</p>
      <div class="rp-dl-bar rp-sp-bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
        <i :style="{ width: pct + '%' }"></i>
      </div>
      <p class="rp-muted rp-small">{{ imp.progress?.done || 0 }} de {{ imp.progress?.total || 0 }} ({{ pct }} %)</p>
      <div class="rp-chips"><button class="rp-btn rp-small" @click="discard">Cancelar y descartar</button></div>
    </template>

    <!-- 2b. Importing -->
    <template v-else-if="imp.status === 'applying'">
      <p>Importando: creando las listas, siguiendo a los artistas y poniendo en cola los discos…</p>
      <div class="rp-dl-bar rp-sp-bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
        <i :style="{ width: pct + '%' }"></i>
      </div>
      <p class="rp-muted rp-small">{{ imp.progress?.done || 0 }} de {{ imp.progress?.total || 0 }}</p>
    </template>

    <!-- 3. It failed -->
    <template v-else-if="imp.status === 'error'">
      <p class="rp-banner rp-banner-error">Se paró al emparejar con Deezer: {{ imp.error }}</p>
      <div class="rp-chips">
        <label class="rp-btn rp-small">Subirla otra vez<input type="file" accept=".zip,.json" hidden @change="upload" /></label>
        <button class="rp-btn rp-small" @click="discard">Descartar</button>
      </div>
    </template>

    <!-- 4. The review -->
    <template v-else>
      <div class="rp-sp-summary">
        <span><strong>{{ s.playlists }}</strong> {{ s.playlists === 1 ? 'lista' : 'listas' }}</span>
        <span><strong>{{ count(s.songs) }}</strong> canciones: {{ s.songs.found || 0 }} encontradas<template v-if="pendingSongs.length">, <a href="#" @click.prevent="tab = 'review'">{{ pendingSongs.length }} por revisar</a></template></span>
        <span><strong>{{ data.artists.length }}</strong> artistas</span>
        <span><strong>{{ data.albums.length }}</strong> discos</span>
        <span v-if="s.skipped.local || s.skipped.episodes" class="rp-muted" title="No están en Deezer: no se traen">
          Fuera: {{ [s.skipped.local ? plural(s.skipped.local, 'archivo local', 'archivos locales') : '', s.skipped.episodes ? plural(s.skipped.episodes, 'episodio de pódcast', 'episodios de pódcast') : ''].filter(Boolean).join(' y ') }}
        </span>
      </div>

      <nav class="rp-tabs rp-sp-tabs" aria-label="Partes de la importación">
        <button v-for="t in tabs" :key="t.id" :class="['rp-chip', { on: tab === t.id }]" @click="tab = t.id">
          {{ t.label }} <small v-if="t.n !== undefined" class="rp-muted">{{ t.n }}</small>
        </button>
      </nav>

      <!-- playlists -->
      <section v-if="tab === 'lists'" class="rp-section">
        <p class="rp-muted rp-small">Cada lista marcada pasa a ser una lista de El Reproductor (y de Navidrome). Puedes cambiarle el nombre.</p>
        <ul class="rp-sl-list">
          <li v-for="p in data.playlists" :key="p.key" class="rp-sl-item rp-sp-row" :class="{ 'rp-sp-off': !p.include }">
            <input type="checkbox" class="rp-sp-check" :checked="p.include" :aria-label="`Traer ${p.name}`" @change="choose({ playlists: { [p.key]: { include: ($event.target as HTMLInputElement).checked } } }, () => (p.include = !p.include))" />
            <span class="rp-sl-main">
              <input class="rp-input rp-sp-name" :value="p.name" maxlength="120" :aria-label="`Nombre de ${p.name}`" @change="rename(p, ($event.target as HTMLInputElement).value)" />
              <small class="rp-muted">{{ found(p) }} de {{ p.songs.length }} encontradas<template v-if="p.kind === 'liked'"> · tus «Me gusta»</template></small>
            </span>
          </li>
        </ul>
      </section>

      <!-- artists -->
      <section v-else-if="tab === 'artists'" class="rp-section">
        <p class="rp-muted rp-small">
          Qué bajar de cada artista que sigues en Spotify. «Solo lo nuevo» no baja nada ahora: solo lo que saquen a partir de hoy.
          <strong>Toda la discografía: unos {{ fmtBytes(s.artists_bytes) }}</strong> de {{ fmtBytes(imp.free_bytes) }} libres.
        </p>
        <div class="rp-sp-all">
          Para todos:
          <button v-for="m in MODES" :key="m.id" class="rp-btn rp-small" :disabled="busy" @click="allArtists(m.id)">{{ m.label }}</button>
        </div>
        <ul class="rp-sl-list">
          <li v-for="a in data.artists" :key="a.uri" class="rp-sl-item">
            <div class="rp-sl-row rp-sp-row">
              <img v-if="a.match?.picture" :src="a.match.picture" alt="" class="rp-sl-cover rp-sp-round" loading="lazy" />
              <span v-else class="rp-sl-cover rp-sp-round rp-avatar-none"><i class="rp-i rp-i-artist" aria-hidden="true"></i></span>
              <span class="rp-sl-main">
                <strong class="rp-ellipsis">{{ a.name }}</strong>
                <small class="rp-muted rp-ellipsis">
                  <template v-if="a.status === 'found'">{{ a.match?.albums || 0 }} lanzamientos en Deezer<template v-if="a.mode === 'all'"> · unos {{ fmtBytes((a.match?.albums || 0) * imp.album_bytes) }}</template></template>
                  <template v-else-if="a.status === 'skipped'">No se sigue</template>
                  <template v-else>{{ a.candidates.length ? 'No está claro cuál es: elige' : 'No está en Deezer' }}</template>
                </small>
              </span>
              <select v-if="a.status === 'found'" class="rp-input rp-sp-mode" :value="a.mode" :aria-label="`Qué bajar de ${a.name}`"
                      @change="setMode(a, ($event.target as HTMLSelectElement).value as any)">
                <option v-for="m in MODES" :key="m.id" :value="m.id">{{ m.label }}</option>
              </select>
              <input v-if="a.status === 'found' && a.mode === 'since'" type="number" class="rp-input rp-sp-year" min="1900" max="2100"
                     :value="a.since_year ?? new Date().getFullYear() - 5" aria-label="Desde el año" @change="setYear(a, ($event.target as HTMLInputElement).value)" />
            </div>
            <ul v-if="a.status === 'doubtful' || (a.status === 'missing' && a.candidates.length)" class="rp-sl-cands">
              <li v-for="c in a.candidates" :key="c.id">
                <img v-if="c.picture" :src="c.picture" alt="" class="rp-sl-cover rp-sp-round" loading="lazy" />
                <span class="rp-sl-main"><span class="rp-ellipsis">{{ c.name }}</span><small class="rp-muted">{{ fmtFans(c.fans) }} · {{ c.albums || 0 }} lanzamientos</small></span>
                <a :href="`https://www.deezer.com/artist/${c.id}`" target="_blank" rel="noopener" class="rp-btn rp-small">Deezer ↗</a>
                <button class="rp-btn rp-small rp-primary" :disabled="busy" @click="pick('artist', a, c.id)">Es este</button>
              </li>
              <li><button class="rp-btn rp-small" :disabled="busy" @click="pick('artist', a, null)">Ninguno: no seguirlo</button></li>
            </ul>
          </li>
        </ul>
      </section>

      <!-- saved albums -->
      <section v-else-if="tab === 'albums'" class="rp-section">
        <p class="rp-muted rp-small">Los discos que guardaste en Spotify, para bajarlos sin seguir al artista. Los marcados: unos {{ fmtBytes(s.albums_bytes) }}.</p>
        <ul class="rp-sl-list">
          <li v-for="al in data.albums" :key="al.uri" class="rp-sl-item">
            <div class="rp-sl-row rp-sp-row" :class="{ 'rp-sp-off': !al.download || al.status !== 'found' }">
              <input v-if="al.status === 'found'" type="checkbox" class="rp-sp-check" :checked="al.download" :aria-label="`Bajar ${al.title}`"
                     @change="choose({ albums: { [al.uri]: { download: ($event.target as HTMLInputElement).checked } } }, () => (al.download = !al.download))" />
              <img v-if="al.match?.cover" :src="al.match.cover" alt="" class="rp-sl-cover" loading="lazy" />
              <span class="rp-sl-main">
                <strong class="rp-ellipsis">{{ al.title }}</strong>
                <small class="rp-muted rp-ellipsis">{{ al.artist }}<template v-if="al.status === 'found' && al.match"> · en Deezer: {{ al.match.title }}<template v-if="al.match.date"> ({{ al.match.date.slice(0, 4) }})</template></template>
                  <template v-else-if="al.status === 'skipped'"> · no se trae</template><template v-else> · {{ al.candidates.length ? 'elige cuál es' : 'no está en Deezer' }}</template></small>
              </span>
            </div>
            <ul v-if="al.status === 'doubtful' || (al.status === 'missing' && al.candidates.length)" class="rp-sl-cands">
              <li v-for="c in al.candidates" :key="c.id">
                <img v-if="c.cover" :src="c.cover" alt="" class="rp-sl-cover" loading="lazy" />
                <span class="rp-sl-main"><span class="rp-ellipsis">{{ c.title }}</span><small class="rp-muted">{{ [c.artist_name, c.date?.slice(0, 4), c.tracks ? `${c.tracks} canciones` : ''].filter(Boolean).join(' · ') }}</small></span>
                <a :href="`https://www.deezer.com/album/${c.id}`" target="_blank" rel="noopener" class="rp-btn rp-small">Deezer ↗</a>
                <button class="rp-btn rp-small rp-primary" :disabled="busy" @click="pick('album', al, c.id)">Es este</button>
              </li>
              <li><button class="rp-btn rp-small" :disabled="busy" @click="pick('album', al, null)">Ninguno: no traerlo</button></li>
            </ul>
          </li>
        </ul>
      </section>

      <!-- songs to review -->
      <section v-else class="rp-section">
        <p v-if="!pendingSongs.length" class="rp-muted">Nada por revisar: todas las canciones están encontradas o decididas.</p>
        <template v-else>
          <p class="rp-muted rp-small">
            Canciones que Deezer no tiene claras (otra versión, en directo, otro remix…) o que no encontró. Escucha las opciones y di cuál es, busca otra, o déjala fuera.
          </p>
          <div class="rp-chips rp-sp-filter">
            <button :class="['rp-chip', { on: review === 'doubtful' }]" @click="review = 'doubtful'">Dudosas <small class="rp-muted">{{ s.songs.doubtful || 0 }}</small></button>
            <button :class="['rp-chip', { on: review === 'missing' }]" @click="review = 'missing'">Sin encontrar <small class="rp-muted">{{ s.songs.missing || 0 }}</small></button>
          </div>
          <p v-if="!shownSongs.length" class="rp-muted rp-small">Ninguna aquí.</p>
          <ul class="rp-sl-list">
            <li v-for="song in shownSongs" :key="song.uri" class="rp-sl-item">
              <div class="rp-sl-row">
                <span class="rp-sl-main">
                  <strong class="rp-ellipsis">{{ song.title }}</strong>
                  <small class="rp-muted rp-ellipsis">{{ [song.artist, song.album].filter(Boolean).join(' · ') }} · en Spotify</small>
                  <small class="rp-muted rp-ellipsis">En {{ listsOf(song.uri) }}</small>
                </span>
              </div>
              <div class="rp-sl-actions">
                <a :href="ytSearch(song.artist, song.title)" target="_blank" rel="noopener" class="rp-btn rp-small" title="Oír la de Spotify en YouTube Music">Original en YT Music ↗</a>
                <button class="rp-btn rp-small" :aria-expanded="!!searchOpen[song.uri]" @click="toggleSearch(song)">{{ searchOpen[song.uri] ? 'Ocultar búsqueda' : 'Buscar otra' }}</button>
                <button class="rp-btn rp-small" :disabled="busy" title="No se trae: sale de sus listas" @click="pick('song', song, null)">No traerla</button>
              </div>
              <form v-if="searchOpen[song.uri]" class="rp-sl-search" @submit.prevent="search(song)">
                <input v-model="queries[song.uri]" class="rp-input" aria-label="Buscar en Deezer" />
                <button class="rp-btn rp-small" :disabled="searching[song.uri]"><span v-if="searching[song.uri]" class="rp-spin"></span> Buscar</button>
              </form>
              <ul class="rp-sl-cands">
                <li v-if="!options(song).length" class="rp-muted rp-small">Deezer no ofreció nada: busca con otras palabras.</li>
                <li v-for="t in options(song)" :key="t.id">
                  <img v-if="t.cover" :src="t.cover" alt="" class="rp-sl-cover" loading="lazy" />
                  <span class="rp-sl-main">
                    <span class="rp-ellipsis">{{ t.title }}</span>
                    <small class="rp-muted rp-ellipsis">{{ [t.artist_name, t.album_title, fmtSec(t.duration)].filter(Boolean).join(' · ') }}</small>
                  </span>
                  <button class="rp-btn rp-small" :disabled="listening.loading === t.id" title="Escuchar 30 segundos" @click="listen(t.id)">
                    <span v-if="listening.loading === t.id" class="rp-spin"></span>
                    <i v-else :class="['rp-i', listening.id === t.id && listening.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i> 30 s
                  </button>
                  <a :href="t.link || `https://www.deezer.com/track/${t.id}`" target="_blank" rel="noopener" class="rp-btn rp-small">Deezer ↗</a>
                  <button class="rp-btn rp-small rp-primary" :disabled="busy" @click="pick('song', song, t.id)">Es esta</button>
                </li>
              </ul>
            </li>
          </ul>
          <p v-if="moreSongs" class="rp-muted rp-small">Y {{ moreSongs }} más: decide estas y salen las siguientes.</p>
        </template>
      </section>

      <footer class="rp-sp-foot">
        <p v-if="imp.error" class="rp-banner rp-banner-error">{{ imp.error }}</p>
        <h2 class="rp-h2">Importar</h2>
        <ul class="rp-sp-plan">
          <li>{{ plural(chosenLists.length, 'lista', 'listas') }} con {{ plural(chosenSongs, 'canción encontrada', 'canciones encontradas') }}<template v-if="pendingSongs.length"> (las {{ pendingSongs.length }} por revisar se quedan fuera si no las decides)</template></li>
          <li>{{ plural(followed.length, 'artista a seguir', 'artistas a seguir') }}<template v-if="followed.some((a) => a.mode === 'all')">: con toda la discografía, unos {{ fmtBytes(s.artists_bytes) }}</template></li>
          <li>{{ plural(chosenAlbums.length, 'disco guardado a bajar', 'discos guardados a bajar') }}<template v-if="chosenAlbums.length">, unos {{ fmtBytes(s.albums_bytes) }}</template></li>
        </ul>
        <p class="rp-muted rp-small">Lo que ya tengas no se baja otra vez, y si repites la importación más adelante, se añade lo nuevo a las mismas listas.</p>
        <div class="rp-chips">
          <button v-if="!confirming" class="rp-btn rp-primary" :disabled="busy" @click="confirming = true">Importar</button>
          <template v-else>
            <strong>¿Importar ahora?</strong>
            <button class="rp-btn rp-primary" :disabled="busy" @click="applyImport"><span v-if="busy" class="rp-spin"></span> Sí, importar</button>
            <button class="rp-btn" :disabled="busy" @click="confirming = false">Todavía no</button>
          </template>
          <label class="rp-btn rp-small">Subir otra descarga<input type="file" accept=".zip,.json" hidden @change="upload" /></label>
          <button class="rp-btn rp-small" @click="discard">Descartar esta importación</button>
        </div>
      </footer>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ask } from '../lib/ask'
import type { Mode, SpotifyAlbum, SpotifyArtist, SpotifyChoices, SpotifyImport, SpotifyPlaylist, SpotifySong, TrackHit } from '../lib/api'
import { player, toggle } from '../lib/player'
import { useStore } from '../lib/store'

const { api, notify, go, refreshPlaylists, refreshFollows, refreshDownloads } = useStore()

const MODES: { id: Mode | 'none'; label: string }[] = [
  { id: 'all', label: 'Toda la discografía' },
  { id: 'since', label: 'Desde un año' },
  { id: 'new', label: 'Solo lo nuevo' },
  { id: 'none', label: 'No seguir' }
]
const PAGE = 50

const imp = ref<SpotifyImport | null>(null)
const loaded = ref(false)
const error = ref('')
const uploading = ref(false)
const busy = ref(false)
const tab = ref<'lists' | 'artists' | 'albums' | 'review'>('lists')
const review = ref<'doubtful' | 'missing'>('doubtful')

const s = computed(() => imp.value!.summary)
const data = computed(() => imp.value!.data!)
const pct = computed(() => {
  const p = imp.value?.progress
  return p && p.total ? Math.floor((p.done / p.total) * 100) : 0
})
const pendingSongs = computed(() => Object.values(data.value?.songs || {}).filter((x) => x.status === 'doubtful' || x.status === 'missing'))
const reviewSongs = computed(() => pendingSongs.value.filter((x) => x.status === review.value))
const shownSongs = computed(() => reviewSongs.value.slice(0, PAGE))
const moreSongs = computed(() => Math.max(0, reviewSongs.value.length - PAGE))
const chosenLists = computed(() => data.value.playlists.filter((p) => p.include))
const chosenSongs = computed(() => new Set(chosenLists.value.flatMap((p) => p.songs.filter((u) => data.value.songs[u]?.status === 'found'))).size)
const followed = computed(() => data.value.artists.filter((a) => a.status === 'found' && a.mode !== 'none'))
const chosenAlbums = computed(() => data.value.albums.filter((a) => a.status === 'found' && a.download))
const confirming = ref(false)
const tabs = computed(() => [
  { id: 'lists' as const, label: 'Listas', n: data.value.playlists.length },
  { id: 'artists' as const, label: 'Artistas', n: data.value.artists.length },
  { id: 'albums' as const, label: 'Discos', n: data.value.albums.length },
  { id: 'review' as const, label: 'Por revisar', n: pendingSongs.value.length }
])

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const count = (c: Record<string, number | undefined>) => Object.values(c).reduce((a: number, b) => a + (b || 0), 0)
const found = (p: SpotifyPlaylist) => p.songs.filter((u) => data.value.songs[u]?.status === 'found').length
const listsOf = (uri: string) => data.value.playlists.filter((p) => p.songs.includes(uri)).map((p) => p.name).join(', ')
const fmtSec = (sec: number) => (sec ? `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, '0')}` : '')
const fmtFans = (n: number | null) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M de fans` : n >= 1e3 ? `${Math.round(n / 1e3)} mil fans` : `${n} fans`)
function fmtBytes(b: number) {
  if (b >= 1024 ** 4) return `${(b / 1024 ** 4).toFixed(1)} TB`
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`
  return `${Math.round(b / 1024 ** 2)} MB`
}
const ytSearch = (artist: string, title: string) => `https://music.youtube.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`

// ---- loading and the pairing's progress ----
let timer: any = null
async function load() {
  error.value = ''
  try {
    const first = (await api.spotifyImport()).import
    imp.value = first && first.status === 'ready' ? (await api.spotifyImport(true)).import : first
  } catch (err: any) {
    error.value = err?.message || String(err)
  } finally {
    loaded.value = true
  }
  clearTimeout(timer)
  if (imp.value?.status === 'matching' || imp.value?.status === 'applying') timer = setTimeout(load, 3000)
  if (imp.value?.status === 'applied' && justApplied) {
    justApplied = false
    await Promise.all([refreshPlaylists(), refreshFollows(), refreshDownloads()].map((p) => p.catch(() => {})))
  }
}
let justApplied = false

async function applyImport() {
  busy.value = true
  try {
    imp.value = (await api.spotifyApply()).import
    confirming.value = false
    justApplied = true
    stopListening()
    await load()
  } catch (err: any) {
    notify(err?.message || String(err), true)
  } finally {
    busy.value = false
  }
}

async function upload(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (imp.value?.status === 'ready' && !(await confirmReplace())) return
  uploading.value = true
  try {
    imp.value = (await api.spotifyUpload(file)).import
    tab.value = 'lists'
    await load()
  } catch (err: any) {
    notify(err?.message || String(err), true)
  } finally {
    uploading.value = false
  }
}
function confirmReplace() {
  return ask('Subir otra descarga sustituye a esta y pierdes lo que hayas decidido en la revisión. ¿Seguir?', 'Seguir', true)
}

async function discard() {
  if (!(await ask('Se descarta esta importación y lo decidido en la revisión. No toca nada de tu música. ¿Seguir?', 'Descartar', true))) return
  try {
    await api.spotifyDiscard()
    imp.value = null
    stopListening()
  } catch (err: any) {
    notify(err?.message || String(err), true)
  }
}

// ---- choices (saved at once; on failure the screen goes back) ----
async function choose(choices: SpotifyChoices, undo?: () => void) {
  try {
    const got = (await api.spotifyChoices(choices)).import
    imp.value!.summary = got.summary
  } catch (err: any) {
    notify(err?.message || String(err), true)
    undo?.()
    await load()
  }
}
function applyLocal(choices: SpotifyChoices) {
  for (const [key, c] of Object.entries(choices.playlists || {})) Object.assign(data.value.playlists.find((p) => p.key === key)!, c)
  for (const [uri, c] of Object.entries(choices.albums || {})) Object.assign(data.value.albums.find((a) => a.uri === uri)!, c)
  for (const [uri, c] of Object.entries(choices.artists || {})) Object.assign(data.value.artists.find((a) => a.uri === uri)!, c)
}
function change(choices: SpotifyChoices) {
  applyLocal(choices)
  return choose(choices)
}
function rename(p: SpotifyPlaylist, name: string) {
  if (!name.trim()) { notify('La lista necesita un nombre', true); return }
  change({ playlists: { [p.key]: { name } } })
}
function setMode(a: SpotifyArtist, mode: Mode | 'none') {
  const extra = mode === 'since' && a.since_year == null ? { since_year: new Date().getFullYear() - 5 } : {}
  change({ artists: { [a.uri]: { mode, ...extra } } })
}
function setYear(a: SpotifyArtist, value: string) {
  const year = Number(value)
  if (!(year >= 1900 && year <= 2100)) { notify('Pon un año entre 1900 y 2100', true); return }
  change({ artists: { [a.uri]: { since_year: year } } })
}
async function allArtists(mode: Mode | 'none') {
  const artists: SpotifyChoices['artists'] = {}
  for (const a of data.value.artists) if (a.status === 'found') artists[a.uri] = mode === 'since' && a.since_year == null ? { mode, since_year: new Date().getFullYear() - 5 } : { mode }
  busy.value = true
  try { await change({ artists }) } finally { busy.value = false }
}

// ---- saying which one it is ----
async function pick(kind: 'song' | 'album' | 'artist', item: SpotifySong | SpotifyAlbum | SpotifyArtist, id: number | null) {
  busy.value = true
  if (kind === 'song') stopListening()
  try {
    const got = await api.spotifyMatch(kind, item.uri, id)
    Object.assign(item, got.item)
    imp.value!.summary = got.summary
  } catch (err: any) {
    notify(err?.message || String(err), true)
  } finally {
    busy.value = false
  }
}

// ---- searching Deezer for another one ----
const searchOpen = reactive<Record<string, boolean>>({})
const queries = reactive<Record<string, string>>({})
const searching = reactive<Record<string, boolean>>({})
const results = reactive<Record<string, TrackHit[]>>({})
function toggleSearch(song: SpotifySong) {
  searchOpen[song.uri] = !searchOpen[song.uri]
  if (searchOpen[song.uri] && queries[song.uri] === undefined) queries[song.uri] = `${song.artist} ${song.title}`
}
async function search(song: SpotifySong) {
  searching[song.uri] = true
  try { results[song.uri] = await api.searchTracks(queries[song.uri] || '') } catch (err: any) { notify(err?.message || String(err), true) } finally { searching[song.uri] = false }
}
const options = (song: SpotifySong): TrackHit[] => results[song.uri] || (song.candidates as TrackHit[])

// ---- listening to Deezer's 30 seconds (the player pauses meanwhile) ----
const listening = reactive({ id: 0, playing: false, loading: 0 })
let audio: HTMLAudioElement | null = null
let blobUrl = ''
async function listen(id: number) {
  if (listening.id === id && audio) {
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
    return
  }
  stopListening()
  listening.loading = id
  try {
    const blob = await api.preview(id)
    if (player.playing) toggle()
    blobUrl = URL.createObjectURL(blob)
    audio = new Audio(blobUrl)
    audio.volume = player.volume
    audio.addEventListener('play', () => { listening.playing = true })
    audio.addEventListener('pause', () => { listening.playing = false })
    audio.addEventListener('ended', () => { listening.playing = false })
    listening.id = id
    await audio.play()
  } catch (err: any) {
    notify(err?.message || String(err), true)
  } finally {
    listening.loading = 0
  }
}
watch(() => player.volume, (v) => { if (audio) audio.volume = v })
function stopListening() {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null }
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = '' }
  listening.id = 0
  listening.playing = false
}

// When the doubtful ones are all decided, show the missing ones (and the other way round).
watch(() => [reviewSongs.value.length, pendingSongs.value.length], ([here, all]) => {
  if (!here && all) review.value = review.value === 'doubtful' ? 'missing' : 'doubtful'
})

onMounted(load)
onBeforeUnmount(() => { clearTimeout(timer); stopListening() })
</script>

<style scoped>
.rp-sp-intro { max-width: 720px; }
.rp-sp-steps { max-width: 720px; padding-left: 22px; line-height: 1.6; list-style: decimal; }
.rp-sp-steps li { display: list-item; margin: 2px 0; }
.rp-sp-upload { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; margin: 8px 0 12px; align-self: flex-start; width: auto; }
.rp-disabled { opacity: .6; pointer-events: none; }
.rp-sp-bar { max-width: 520px; height: 8px; margin: 12px 0 6px; }
.rp-sp-summary { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 4px 0 14px; }
.rp-sp-tabs { margin-bottom: 12px; }
.rp-sp-tabs small, .rp-sp-filter small { margin-left: 6px; }
.rp-sp-row { display: flex; align-items: center; gap: 10px; }
.rp-sp-off { opacity: .55; }
.rp-sp-check { width: 18px; height: 18px; flex: none; accent-color: var(--rp-accent); }
.rp-sp-name { max-width: 420px; padding: 4px 8px; font-weight: 600; }
.rp-sp-mode { width: auto; flex: none; }
.rp-sp-year { width: 90px; flex: none; }
.rp-sp-round { border-radius: 50%; }
.rp-sp-all { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 6px 0 12px; }
.rp-sp-filter { margin: 6px 0 10px; }
.rp-sp-foot { margin-top: 24px; padding-top: 14px; border-top: 1px solid var(--rp-line); }
.rp-sp-plan, .rp-sp-done ul { padding-left: 20px; list-style: disc; line-height: 1.6; }
.rp-sp-plan li, .rp-sp-done li { display: list-item; }
.rp-sp-done { margin: 4px 0 18px; padding: 12px 16px; border: 1px solid var(--rp-accent); border-radius: 12px; background: rgba(31,184,102,.08); }
</style>
