<template>
  <section class="rp-page">
    <p v-if="!album" class="rp-muted">{{ lib.loaded ? 'Este disco ya no está en tus carpetas.' : 'Cargando…' }}</p>
    <template v-else>
      <header class="rp-hero">
        <img v-if="cover" :src="cover" alt="" class="rp-hero-pic" />
        <span v-else class="rp-hero-pic rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
        <div class="rp-hero-text">
          <span class="rp-muted rp-small">Disco · en este equipo</span>
          <h1 class="rp-h1 rp-big">{{ album.title || 'Sin disco' }}</h1>
          <span class="rp-small">
            <a v-if="album.artist !== 'Varios artistas'" href="#" @click.prevent="go({ v: 'lartist', name: album.artist })"><strong>{{ album.artist }}</strong></a>
            <strong v-else>{{ album.artist }}</strong>
            <span class="rp-muted"><template v-if="album.year"> · {{ album.year }}</template> · {{ album.tracks.length }} {{ album.tracks.length === 1 ? 'canción' : 'canciones' }} · {{ fmtLength(album.duration) }}</span>
          </span>
          <div class="rp-hero-actions">
            <button class="rp-btn rp-primary rp-round-btn" title="Reproducir" @click="play(songs, null, false)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
            <button class="rp-act" title="Aleatorio" aria-label="Reproducir en orden aleatorio" @click="play(songs, null, true)"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i></button>
            <AddToDeviceList :songs="songs" />
            <ActionMenu :items="[
              { label: 'Siguiente en la cola', note: 'Que suene después de la canción actual', icon: 'rp-i-queue', run: () => { playNext(songs); notify('Sonará a continuación.') } },
              { label: 'Abrir su carpeta', icon: 'rp-i-folder-open', if: !!device!.backend.reveal, run: () => device!.backend.reveal!(album!.tracks[0].path) }
            ]" />
          </div>
        </div>
      </header>
      <SongList :songs="songs" :numbers="album.tracks.map((t, i) => t.track || i + 1)" :show-album="false" :show-artist="mixed" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { play, playNext } from '../lib/player'
import { useStore } from '../lib/store'
import ActionMenu from './ActionMenu.vue'
import AddToDeviceList from './AddToDeviceList.vue'
import SongList from './SongList.vue'

const props = defineProps<{ albumKey: string }>()
const { device, go, notify } = useStore()
const lib = device!.state
const album = computed(() => (lib.tracks, device!.album(props.albumKey)))
const cover = computed(() => device!.cover(album.value?.cover || null))
const songs = computed(() => (album.value ? device!.songs(album.value.tracks) : []))
/** the songs are by different artists (a compilation, guests): each shows its own */
const mixed = computed(() => !!album.value && album.value.tracks.some((t) => t.artist !== album.value!.artist))
const fmtLength = (s: number) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min` }
</script>
