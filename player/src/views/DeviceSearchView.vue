<template>
  <section :class="embedded ? 'rp-section' : 'rp-page'">
    <header v-if="!embedded" class="rp-page-head">
      <input ref="input" v-model="query" class="rp-search" type="search" placeholder="¿Qué quieres escuchar?" aria-label="Buscar en tu música" @input="update" />
    </header>
    <p v-if="!embedded && !q" class="rp-muted">Busca por canción, artista o disco entre la música de este equipo.</p>
    <template v-else-if="q">
      <p v-if="!embedded && !artists.length && !albums.length && !tracks.length" class="rp-muted">Nada con «{{ q }}» en este equipo.</p>
      <h2 v-if="embedded && (artists.length || albums.length || tracks.length)" class="rp-h2">En este equipo</h2>
      <section v-if="artists.length" class="rp-section">
        <h3 v-if="!embedded" class="rp-h2">Artistas</h3>
        <div class="rp-grid rp-grid-artists">
          <a v-for="a in artists.slice(0, 6)" :key="a.name" href="#" class="rp-artist-card" @click.prevent="go({ v: 'lartist', name: a.name })">
            <img v-if="a.cover" :src="device!.cover(a.cover)!" alt="" loading="lazy" />
            <span v-else class="rp-artist-none"><i class="rp-i rp-i-artist" aria-hidden="true"></i></span>
            <strong class="rp-ellipsis">{{ a.name }}</strong>
          </a>
        </div>
      </section>
      <section v-if="albums.length" class="rp-section">
        <h3 v-if="!embedded" class="rp-h2">Discos</h3>
        <div class="rp-grid"><DeviceAlbumCard v-for="a in albums.slice(0, 12)" :key="a.key" :album="a" /></div>
      </section>
      <section v-if="tracks.length" class="rp-section">
        <h3 v-if="!embedded" class="rp-h2">Canciones <small class="rp-muted">{{ tracks.length }}</small></h3>
        <SongList :songs="songs" covers />
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { matchesName, searchTracks } from '../lib/device'
import { useStore } from '../lib/store'
import DeviceAlbumCard from './DeviceAlbumCard.vue'
import SongList from './SongList.vue'

/** Search in this device's music; `embedded`: a section of the server's search, with the words it was given. */
const props = withDefaults(defineProps<{ q?: string; embedded?: boolean }>(), { q: '', embedded: false })
const { device, go } = useStore()
const lib = device!.state
const input = ref<HTMLInputElement>()
const query = ref(props.q)
const q = computed(() => (props.embedded ? props.q : query.value).trim())
let timer: any = null
function update() {
  clearTimeout(timer)
  timer = setTimeout(() => go({ v: 'search', ...(query.value.trim() ? { q: query.value.trim() } : {}) }, true), 300)
}
const artists = computed(() => (lib.tracks, device!.artists.filter((a) => matchesName(a.name, q.value))))
const albums = computed(() => (lib.tracks, device!.albums.filter((a) => matchesName(`${a.title} ${a.artist}`, q.value))))
const tracks = computed(() => searchTracks(lib.tracks, q.value))
const songs = computed(() => device!.songs(tracks.value.slice(0, props.embedded ? 10 : 100)))
onMounted(() => { if (!props.embedded) input.value?.focus() })
</script>
