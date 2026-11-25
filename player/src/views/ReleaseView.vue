<template>
  <section class="rp-page">
    <p v-if="error" class="rp-banner rp-banner-error">{{ error }}</p>
    <p v-else-if="!album" class="rp-muted"><span class="rp-spin"></span> Cargando el disco…</p>
    <template v-else>
      <header class="rp-hero">
        <img v-if="album.cover" :src="album.cover" alt="" class="rp-hero-pic" />
        <span v-else class="rp-hero-pic rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
        <div class="rp-hero-text">
          <span class="rp-muted rp-small">{{ kindLabel(album.kind) }}</span>
          <h1 class="rp-h1 rp-big">{{ album.title }}</h1>
          <span class="rp-small">
            <a v-if="album.artist_id" href="#" @click.prevent="go({ v: 'artist', id: album.artist_id })"><strong>{{ album.artist_name }}</strong></a>
            <span class="rp-muted"> · {{ fmtDate(album.date) }} · {{ album.songs.length }} canciones<template v-if="total"> · {{ fmtLength(total) }}</template></span>
          </span>
          <div class="rp-hero-actions">
            <button v-if="songs.length" class="rp-btn rp-primary rp-round-btn" title="Reproducir" @click="play(songs, null, false)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
            <button v-if="songs.length" class="rp-btn" @click="play(songs, null, true)"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i> Aleatorio</button>
            <button v-if="songs.length" class="rp-btn" title="Que suene después de la canción actual" @click="playNext(songs); notify('Sonará a continuación.')">Siguiente en la cola</button>
            <OfflineButton :paths="songs.map((s) => s.path)" />
            <button v-if="canDownload" class="rp-btn rp-primary" :disabled="busy" @click="download">
              <span v-if="busy" class="rp-spin"></span> <i class="rp-i rp-i-download" aria-hidden="true"></i> Bajar {{ missing === album.songs.length ? 'el disco' : `lo que falta (${missing})` }}
            </button>
            <span v-if="badge" :class="['rp-badge', 'rp-badge-big', `rp-badge-${album.mine!.status}`]" :title="label.hint">{{ label.text }}</span>
            <button v-if="album.mine?.status === 'wanted' && album.followed" class="rp-btn" @click="skip">No bajar</button>
            <AddToPlaylist kind="release" :id="album.id" :followed="album.followed" />
            <button v-if="songs.length" class="rp-btn rp-danger" :title="`Borrar de ${where} las canciones que tienes de este disco`" @click="removeAlbum">
              <i class="rp-i rp-i-delete" aria-hidden="true"></i> Borrar
            </button>
          </div>
          <span v-if="label.hint && badge" class="rp-muted rp-small">{{ label.hint }}</span>
          <span v-if="album.mine?.result?.failed" class="rp-muted rp-small">{{ album.mine.result.failed }} {{ album.mine.result.failed === 1 ? 'canción no se pudo bajar' : 'canciones no se pudieron bajar' }}.</span>
          <span v-if="!album.mine && !album.followed && !songs.length" class="rp-muted rp-small">No sigues a este artista: puedes bajar el disco entero o solo algunas canciones (con su botón de bajar).</span>
        </div>
      </header>
      <TrackList :hits="album.songs" @changed="load" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AlbumPage } from '../lib/api'
import { heldSongs, kindLabel, statusLabel, fmtDate } from '../lib/library'
import { play, playNext } from '../lib/player'
import { useStore } from '../lib/store'
import AddToPlaylist from './AddToPlaylist.vue'
import OfflineButton from './OfflineButton.vue'
import TrackList from './TrackList.vue'

/** Any release of the catalogue: mine (downloaded, on its way, left out) or not; each song with what I have. */
const props = defineProps<{ id: number }>()
const { api, state, go, notify, refreshFollows, remove, where } = useStore()
const album = ref<AlbumPage | null>(null)
const error = ref('')
const busy = ref(false)

const songs = computed(() => heldSongs(album.value?.songs || []))
const total = computed(() => (album.value?.songs || []).reduce((s, t) => s + t.duration, 0))
const missing = computed(() => (album.value?.songs || []).filter((t) => !t.have).length)
const canDownload = computed(() => !!album.value && missing.value > 0 && !['wanted', 'downloading'].includes(album.value.mine?.status || ''))
const badge = computed(() => !!album.value?.mine && album.value.mine.status !== 'done')
const label = computed(() => statusLabel(album.value?.mine || { status: 'wanted', reason: '' } as any))
const fmtLength = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`)

async function load() {
  try {
    album.value = await api.album(props.id)
    error.value = ''
  } catch (err: any) {
    error.value = err?.status === 404 ? 'Deezer no tiene este disco.' : `No se pudo cargar el disco: ${err?.message || err}`
  }
}
async function download() {
  busy.value = true
  try {
    const whole = album.value?.mine?.status !== 'done'
    await api.choose(props.id, 'download')
    notify(whole ? `Bajando «${album.value?.title}».` : `Bajando lo que falta de «${album.value?.title}».`)
    await Promise.all([load(), refreshFollows()])
  } catch (err: any) { notify(err?.message || String(err), true) } finally { busy.value = false }
}
async function removeAlbum() {
  const a = album.value
  if (!a) return
  if (await remove({ title: `¿Borrar «${a.title}»?`, paths: a.songs.map((t) => t.file?.path) })) await load()
}
async function skip() {
  try { await api.choose(props.id, 'skip'); await Promise.all([load(), refreshFollows()]) } catch (err: any) { notify(err?.message || String(err), true) }
}

// While something of it is on its way, look again every few seconds.
let timer: any = null
const coming = computed(() => ['wanted', 'downloading'].includes(album.value?.mine?.status || '') || (album.value?.songs || []).some((t) => t.have === 'coming'))
watch(coming, (on) => {
  clearInterval(timer)
  if (on) timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 8000)
}, { immediate: true })
const counts = computed(() => JSON.stringify(state.follows.find((f) => f.artist_id === album.value?.artist_id)?.counts || null))
watch(counts, () => { if (coming.value) load() })
onMounted(load)
onBeforeUnmount(() => clearInterval(timer))
</script>
