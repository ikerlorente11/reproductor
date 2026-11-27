<template>
  <section class="rp-page">
    <header class="rp-page-head">
      <nav class="rp-crumbs" aria-label="Carpeta">
        <template v-for="(c, i) in crumbs" :key="c.path">
          <span v-if="i" class="rp-muted">/</span>
          <a v-if="i < crumbs.length - 1" href="#" @click.prevent="go({ v: 'folder', path: c.path })">{{ c.name }}</a>
          <strong v-else class="rp-h1">{{ c.name }}</strong>
        </template>
      </nav>
      <span class="rp-grow"></span>
      <input v-model="filter" class="rp-search rp-search-small" type="search" placeholder="Filtrar" />
      <button class="rp-btn rp-primary rp-round-btn" :disabled="!shown.length" title="Reproducir" @click="play(shown, null, false)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
      <button class="rp-act" :disabled="!shown.length" title="Aleatorio" aria-label="Reproducir en orden aleatorio" @click="play(shown, null, true)"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i></button>
    </header>

    <p v-if="error" class="rp-banner rp-banner-error">{{ error }}</p>
    <p v-else-if="loading" class="rp-muted"><span class="rp-spin"></span> Cargando…</p>
    <template v-else>
      <ul v-if="subfolders.length" class="rp-folder-grid">
        <li v-for="f in subfolders" :key="f.path">
          <a href="#" class="rp-folder" @click.prevent="go({ v: 'folder', path: f.path })"><span class="rp-avatar rp-avatar-folder"><i class="rp-i rp-i-folder" aria-hidden="true"></i></span><span class="rp-ellipsis">{{ f.name }}</span></a>
          <button class="rp-mini" title="Reproducir esta carpeta (con sus subcarpetas)" @click="playFolder(f.path)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
        </li>
      </ul>
      <ol v-if="shown.length" class="rp-tracks">
        <li v-for="(s, i) in shown" :key="s.key" :class="{ on: nowPlaying?.key === s.key }" @dblclick="play(shown, s)">
          <button class="rp-tplay" @click="play(shown, s)"><span class="rp-tnum">{{ i + 1 }}</span><span class="rp-ticon"><i :class="['rp-i', nowPlaying?.key === s.key && player.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i></span></button>
          <span class="rp-tinfo"><span class="rp-ellipsis">{{ s.title }}</span><small v-if="s.artist" class="rp-muted rp-ellipsis">{{ s.artist }}</small></span>
          <span class="rp-muted rp-small rp-tdur">{{ s.size }}</span>
        </li>
      </ol>
      <p v-if="!subfolders.length && !shown.length" class="rp-muted">{{ filter ? `Nada coincide con «${filter}».` : missing ? `Aún no tienes la carpeta «${path}».` : 'Esta carpeta no tiene música.' }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { isAudioName, songArtist, songTitle, type Song } from '../lib/library'
import { nowPlaying, play, player } from '../lib/player'
import { useStore } from '../lib/store'

/** Music by folder, as it is in the cloud: what was downloaded or uploaded outside El Reproductor. */
const props = defineProps<{ path: string; playFile?: string }>()
const { go, notify, files } = useStore()

type FolderSong = Song & { size: string }
const subfolders = ref<{ path: string; name: string }[]>([])
const songs = ref<FolderSong[]>([])
const loading = ref(true)
const error = ref('')
const missing = ref(false)
const filter = ref('')

const crumbs = computed(() => {
  const parts = props.path.split('/').filter(Boolean)
  return parts.map((name, i) => ({ name, path: '/' + parts.slice(0, i + 1).join('/') }))
})
const shown = computed(() => {
  const f = filter.value.trim().toLowerCase()
  return f ? songs.value.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(f)) : songs.value
})

const fmtSize = (n: number) => (n ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : '')
async function list(dir: string) {
  const found = await files.list(dir)
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'es', { numeric: true })
  const folder = dir.split('/').pop() || ''
  return {
    folders: [...found.folders].sort(byName),
    songs: found.files.filter((f) => isAudioName(f.name)).sort(byName).map((f): FolderSong => ({
      key: f.path, path: f.path, title: songTitle(f.path), artist: songArtist(f.path), album: folder, cover: null, duration: 0,
      size: fmtSize(f.size)
    }))
  }
}
async function load() {
  loading.value = true
  try {
    const found = await list(props.path)
    subfolders.value = found.folders
    songs.value = found.songs
    error.value = ''
    missing.value = false
    if (props.playFile) {
      const song = songs.value.find((s) => s.path === props.playFile)
      if (song) play(songs.value, song, false)
    }
  } catch (err: any) {
    if (err?.status === 404) missing.value = true
    else error.value = `No se pudo leer la carpeta: ${err?.message || err}`
    subfolders.value = []
    songs.value = []
  } finally {
    loading.value = false
  }
}
/** A folder and everything under it, in name order (an album per subfolder, say). */
async function playFolder(dir: string) {
  try {
    const all: Song[] = []
    const walk = async (d: string, depth: number) => {
      const found = await list(d)
      all.push(...found.songs)
      if (depth < 3) for (const f of found.folders) await walk(f.path, depth + 1)
    }
    await walk(dir, 0)
    if (!all.length) { notify('Esa carpeta no tiene música.', true); return }
    play(all, null)
  } catch (err: any) { notify(`No se pudo leer la carpeta: ${err?.message || err}`, true) }
}
onMounted(load)
</script>
