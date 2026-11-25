<template>
  <section class="rp-page">
    <p v-if="!artist" class="rp-muted">{{ lib.loaded ? 'No hay canciones de este artista en tus carpetas.' : 'Cargando…' }}</p>
    <template v-else>
      <header class="rp-hero">
        <img v-if="cover" :src="cover" alt="" class="rp-hero-pic rp-hero-round" />
        <span v-else class="rp-hero-pic rp-hero-round rp-cover-none"><i class="rp-i rp-i-artist" aria-hidden="true"></i></span>
        <div class="rp-hero-text">
          <span class="rp-muted rp-small">Artista · en este equipo</span>
          <h1 class="rp-h1 rp-big">{{ artist.name }}</h1>
          <span class="rp-muted rp-small">{{ artist.albums.length }} {{ artist.albums.length === 1 ? 'disco' : 'discos' }} · {{ artist.tracks.length }} {{ artist.tracks.length === 1 ? 'canción' : 'canciones' }}</span>
          <div class="rp-hero-actions">
            <button class="rp-btn rp-primary rp-round-btn" title="Reproducir todo" @click="play(all, null, false)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
            <button class="rp-btn" @click="play(all, null, true)"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i> Aleatorio</button>
            <AddToDeviceList :songs="all" />
          </div>
        </div>
      </header>

      <section v-if="artist.albums.length" class="rp-section">
        <h2 class="rp-h2">Discos</h2>
        <div class="rp-grid"><DeviceAlbumCard v-for="a in artist.albums" :key="a.key" :album="a" :show-artist="false" /></div>
      </section>
      <section v-if="guest.length" class="rp-section">
        <h2 class="rp-h2">También aparece en</h2>
        <SongList :songs="guest" covers />
      </section>
      <section class="rp-section">
        <h2 class="rp-h2">Todas sus canciones</h2>
        <SongList :songs="all" covers :show-artist="false" />
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { play } from '../lib/player'
import { useStore } from '../lib/store'
import AddToDeviceList from './AddToDeviceList.vue'
import DeviceAlbumCard from './DeviceAlbumCard.vue'
import SongList from './SongList.vue'

const props = defineProps<{ name: string }>()
const { device } = useStore()
const lib = device!.state
const artist = computed(() => (lib.tracks, device!.artist(props.name)))
const cover = computed(() => device!.cover(artist.value?.cover || null))
/** their albums' songs in order, then the songs on others' albums */
const all = computed(() => {
  const a = artist.value
  if (!a) return []
  const onAlbums = a.albums.flatMap((al) => al.tracks)
  const seen = new Set(onAlbums.map((t) => t.id))
  return device!.songs([...onAlbums, ...a.tracks.filter((t) => !seen.has(t.id))])
})
const guest = computed(() => {
  const a = artist.value
  if (!a) return []
  const own = new Set(a.albums.flatMap((al) => al.tracks.map((t) => t.id)))
  return device!.songs(a.tracks.filter((t) => !own.has(t.id)))
})
</script>
