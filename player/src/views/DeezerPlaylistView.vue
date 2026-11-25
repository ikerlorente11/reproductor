<template>
  <section class="rp-page">
    <p v-if="error" class="rp-banner rp-banner-error">{{ error }}</p>
    <p v-else-if="!list" class="rp-muted"><span class="rp-spin"></span> Cargando la lista…</p>
    <template v-else>
      <header class="rp-hero">
        <img v-if="list.cover" :src="list.cover" alt="" class="rp-hero-pic" />
        <span v-else class="rp-hero-pic rp-cover-none"><i class="rp-i rp-i-playlist" aria-hidden="true"></i></span>
        <div class="rp-hero-text">
          <span class="rp-muted rp-small">Lista de Deezer<template v-if="list.owner"> · de {{ list.owner }}</template></span>
          <h1 class="rp-h1 rp-big">{{ list.title }}</h1>
          <span class="rp-muted rp-small">{{ list.songs.length }} canciones · tienes {{ held }}<template v-if="coming"> · {{ coming }} bajando</template></span>
          <div class="rp-hero-actions">
            <button v-if="songs.length" class="rp-btn rp-primary rp-round-btn" title="Reproducir lo que tienes" @click="play(songs, null, false)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
            <button v-if="songs.length" class="rp-btn" @click="play(songs, null, true)"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i> Aleatorio</button>
            <button v-if="missing" class="rp-btn rp-primary" :disabled="busy" title="Cada canción que te falte, suelta (no se sigue a nadie)" @click="downloadAll">
              <span v-if="busy" class="rp-spin"></span> <i class="rp-i rp-i-download" aria-hidden="true"></i> Bajar las que faltan ({{ missing }})
            </button>
            <button class="rp-btn" :disabled="saving" title="Una lista tuya con estas canciones: se bajan las que falten y pasa a Navidrome" @click="save">
              <span v-if="saving" class="rp-spin"></span> <i class="rp-i rp-i-playlist" aria-hidden="true"></i> Guardar como lista mía
            </button>
          </div>
          <p v-if="list.description" class="rp-muted rp-small rp-desc">{{ list.description }}</p>
        </div>
      </header>
      <TrackList :hits="list.songs" show-artist show-album @changed="load" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DeezerPlaylistPage } from '../lib/api'
import { heldSongs } from '../lib/library'
import { play } from '../lib/player'
import { useStore } from '../lib/store'
import TrackList from './TrackList.vue'

/** A public Deezer playlist: play what I have of it, download the rest, keep it as a list of mine. */
const props = defineProps<{ id: number }>()
const { api, go, notify, refreshPlaylists } = useStore()
const list = ref<DeezerPlaylistPage | null>(null)
const error = ref('')
const busy = ref(false)
const saving = ref(false)

const songs = computed(() => heldSongs(list.value?.songs || []))
const held = computed(() => (list.value?.songs || []).filter((t) => t.have === 'done').length)
const coming = computed(() => (list.value?.songs || []).filter((t) => t.have === 'coming').length)
const missing = computed(() => (list.value?.songs || []).filter((t) => !t.have).length)

async function load() {
  try {
    list.value = await api.deezerPlaylist(props.id)
    error.value = ''
  } catch (err: any) {
    error.value = err?.status === 404 ? 'Esta lista no existe o es privada.' : `No se pudo cargar la lista: ${err?.message || err}`
  }
}
async function downloadAll() {
  busy.value = true
  try {
    const { asked } = await api.downloadDeezerPlaylist(props.id)
    notify(`Bajando ${asked} ${asked === 1 ? 'canción' : 'canciones'}.`)
    await load()
  } catch (err: any) { notify(err?.message || String(err), true) } finally { busy.value = false }
}
async function save() {
  saving.value = true
  try {
    const mine = await api.saveDeezerPlaylist(props.id)
    await refreshPlaylists()
    notify(`Guardada como «${mine.name}». Se bajará lo que falte.`)
    go({ v: 'playlist', id: mine.id })
  } catch (err: any) { notify(err?.message || String(err), true) } finally { saving.value = false }
}

let timer: any = null
watch(coming, (n) => {
  clearInterval(timer)
  if (n) timer = setInterval(() => { if (document.visibilityState === 'visible') load() }, 8000)
})
onMounted(load)
onBeforeUnmount(() => clearInterval(timer))
</script>
