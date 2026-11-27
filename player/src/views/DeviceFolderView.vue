<template>
  <section class="rp-page">
    <header class="rp-page-head">
      <nav class="rp-crumbs" aria-label="Carpeta">
        <template v-for="(c, i) in crumbs" :key="c.path">
          <span v-if="i" class="rp-muted">\</span>
          <a v-if="i < crumbs.length - 1" href="#" @click.prevent="go({ v: 'lfolder', path: c.path })">{{ c.name }}</a>
          <strong v-else class="rp-h1">{{ c.name }}</strong>
        </template>
      </nav>
      <span class="rp-grow"></span>
      <button class="rp-btn rp-primary rp-round-btn" :disabled="!all.length" title="Reproducir la carpeta (con sus subcarpetas)" @click="play(all, null, false)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
      <button class="rp-act" :disabled="!all.length" title="Aleatorio" aria-label="Reproducir en orden aleatorio" @click="play(all, null, true)"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i></button>
    </header>
    <ul v-if="found.folders.length" class="rp-folder-grid">
      <li v-for="f in found.folders" :key="f.path">
        <a href="#" class="rp-folder" @click.prevent="go({ v: 'lfolder', path: f.path })"><span class="rp-avatar rp-avatar-folder"><i class="rp-i rp-i-folder" aria-hidden="true"></i></span>
          <span class="rp-ellipsis">{{ f.name }}</span></a>
        <button class="rp-mini" title="Reproducir esta carpeta" @click="playFolder(f.path)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
      </li>
    </ul>
    <SongList v-if="songs.length" :songs="songs" />
    <p v-if="!found.folders.length && !songs.length" class="rp-muted">Esta carpeta no tiene música.</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { deviceFolder } from '../lib/device'
import { play } from '../lib/player'
import { useStore } from '../lib/store'
import SongList from './SongList.vue'

/** A folder of this device as it is on the disk: its folders and its songs (from the index, nothing is read). */
const props = defineProps<{ path: string }>()
const { device, go } = useStore()
const lib = device!.state
const root = computed(() => lib.roots.find((r) => props.path.toLowerCase().startsWith(r.toLowerCase())) || props.path)
const crumbs = computed(() => {
  const r = root.value.replace(/[\\/]+$/, '')
  const rest = props.path.slice(r.length).split(/[\\/]/).filter(Boolean)
  const sep = r.includes('\\') ? '\\' : '/'
  const out = [{ name: r.split(/[\\/]/).pop() || r, path: r }]
  rest.forEach((name, i) => out.push({ name, path: r + sep + rest.slice(0, i + 1).join(sep) }))
  return out
})
const found = computed(() => deviceFolder(lib.tracks, props.path))
const songs = computed(() => device!.songs(found.value.tracks))
const under = (dir: string) => { const d = dir.replace(/[\\/]+$/, '').toLowerCase(); return lib.tracks.filter((t) => t.path.toLowerCase().startsWith(d + '\\') || t.path.toLowerCase().startsWith(d + '/')) }
const all = computed(() => device!.songs([...under(props.path)].sort((a, b) => a.path.localeCompare(b.path, 'es', { numeric: true }))))
function playFolder(dir: string) { play(device!.songs([...under(dir)].sort((a, b) => a.path.localeCompare(b.path, 'es', { numeric: true }))), null) }
</script>
