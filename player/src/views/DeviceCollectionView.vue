<template>
  <section class="rp-page">
    <header class="rp-page-head">
      <h1 class="rp-h1">{{ heading }} <small class="rp-muted">{{ count }}</small></h1>
      <span class="rp-grow"></span>
      <input v-model="filter" class="rp-search rp-search-small" type="search" placeholder="Filtrar" />
      <select v-model="sort" class="rp-input" aria-label="Ordenar">
        <option v-for="o in sorts" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <template v-if="kind === 'songs'">
        <button class="rp-btn rp-primary rp-round-btn" :disabled="!songs.length" title="Reproducir" @click="play(songs, null, false)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
        <button class="rp-act" :disabled="!songs.length" title="Aleatorio" aria-label="Reproducir en orden aleatorio" @click="play(songs, null, true)"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i></button>
      </template>
    </header>

    <p v-if="!lib.loaded" class="rp-muted"><span class="rp-spin"></span> Cargando…</p>
    <p v-else-if="!count" class="rp-muted">{{ filter ? `Nada coincide con «${filter}».` : 'Aún no hay música en tus carpetas.' }}</p>
    <template v-else-if="kind === 'songs'">
      <SongList :songs="shownSongs" covers :extra="sort === 'added' ? (s) => addedLabel(s.device) : undefined" />
      <p v-if="songs.length > shownSongs.length" class="rp-center"><button class="rp-btn" @click="limit += 500">Ver más ({{ songs.length - shownSongs.length }})</button></p>
    </template>
    <div v-else-if="kind === 'albums'" class="rp-grid"><DeviceAlbumCard v-for="a in shownAlbums" :key="a.key" :album="a" /></div>
    <div v-else class="rp-grid rp-grid-artists">
      <a v-for="a in shownArtists" :key="a.name" href="#" class="rp-artist-card" @click.prevent="go({ v: 'lartist', name: a.name })">
        <img v-if="a.cover" :src="device!.cover(a.cover)!" alt="" loading="lazy" />
        <span v-else class="rp-artist-none"><i class="rp-i rp-i-artist" aria-hidden="true"></i></span>
        <strong class="rp-ellipsis">{{ a.name }}</strong>
        <small class="rp-muted">{{ a.tracks.length }} {{ a.tracks.length === 1 ? 'canción' : 'canciones' }}</small>
      </a>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { matchesName, searchTracks, type DeviceTrack } from '../lib/device'
import { play } from '../lib/player'
import { useStore } from '../lib/store'
import DeviceAlbumCard from './DeviceAlbumCard.vue'
import SongList from './SongList.vue'

/** Everything of this device: its songs, albums or artists, filtered and sorted (the choice is remembered). */
const props = defineProps<{ kind: 'songs' | 'albums' | 'artists' }>()
const { device, go } = useStore()
const lib = device!.state
const heading = { songs: 'Canciones', albums: 'Discos', artists: 'Artistas' }[props.kind]
const SORTS = {
  songs: [{ value: 'title', label: 'Título' }, { value: 'artist', label: 'Artista' }, { value: 'album', label: 'Disco' }, { value: 'added', label: 'Añadidas hace poco' }, { value: 'duration', label: 'Duración' }],
  albums: [{ value: 'artist', label: 'Artista' }, { value: 'title', label: 'Título' }, { value: 'year', label: 'Año' }, { value: 'added', label: 'Añadidos hace poco' }],
  artists: [{ value: 'name', label: 'Nombre' }, { value: 'songs', label: 'Más canciones' }]
}
const sorts = SORTS[props.kind]
const KEY = `reproductor.sort.${props.kind}`
const sort = ref(((): string => { try { return localStorage.getItem(KEY) || sorts[0].value } catch (_) { return sorts[0].value } })())
watch(sort, (v) => { try { localStorage.setItem(KEY, v) } catch (_) {} })
const filter = ref('')
const limit = ref(500)
const cmp = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true })

const tracks = computed<DeviceTrack[]>(() => {
  const list = filter.value.trim() ? searchTracks(lib.tracks, filter.value) : [...lib.tracks]
  const by: Record<string, (a: DeviceTrack, b: DeviceTrack) => number> = {
    title: (a, b) => cmp(a.title, b.title),
    artist: (a, b) => cmp(a.artist, b.artist) || cmp(a.album, b.album) || (a.disc - b.disc) || (a.track - b.track),
    album: (a, b) => cmp(a.album, b.album) || (a.disc - b.disc) || (a.track - b.track),
    added: (a, b) => b.added - a.added || cmp(a.path, b.path),
    duration: (a, b) => b.duration - a.duration
  }
  return list.sort(by[sort.value] || by.title)
})
const songs = computed(() => (props.kind === 'songs' ? device!.songs(tracks.value) : []))
const shownSongs = computed(() => songs.value.slice(0, limit.value))
const byId = computed(() => new Map(lib.tracks.map((t) => [t.id, t])))
const addedLabel = (id?: string) => { const t = id ? byId.value.get(id) : null; return t?.added ? new Date(t.added * 1000).toLocaleDateString('es') : '' }

const shownAlbums = computed(() => {
  const q = filter.value.trim()
  const list = (lib.tracks, device!.albums).filter((a) => !q || matchesName(`${a.title} ${a.artist}`, q))
  const by: Record<string, (a: typeof list[0], b: typeof list[0]) => number> = {
    artist: (a, b) => cmp(a.artist, b.artist) || a.year - b.year,
    title: (a, b) => cmp(a.title, b.title),
    year: (a, b) => b.year - a.year || cmp(a.artist, b.artist),
    added: (a, b) => b.added - a.added
  }
  return [...list].sort(by[sort.value] || by.artist)
})
const shownArtists = computed(() => {
  const q = filter.value.trim()
  const list = (lib.tracks, device!.artists).filter((a) => !q || matchesName(a.name, q))
  return sort.value === 'songs' ? [...list].sort((a, b) => b.tracks.length - a.tracks.length) : list
})
const count = computed(() => (props.kind === 'songs' ? tracks.value.length : props.kind === 'albums' ? shownAlbums.value.length : shownArtists.value.length))
</script>
