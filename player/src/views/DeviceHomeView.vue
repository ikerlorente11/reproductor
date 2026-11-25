<template>
  <section class="rp-page">
    <header class="rp-page-head">
      <h1 class="rp-h1">{{ greeting }}</h1>
      <span class="rp-grow"></span>
      <button v-if="lib.roots.length" class="rp-btn" :disabled="lib.scanning" title="Buscar canciones nuevas en tus carpetas" @click="device!.backend.scan()">
        <span v-if="lib.scanning" class="rp-spin"></span><i v-else class="rp-i rp-i-refresh" aria-hidden="true"></i> Buscar música nueva
      </button>
    </header>

    <p v-if="lib.scanning && lib.progress.total" class="rp-strip"><span class="rp-spin"></span> Leyendo tu música: {{ lib.progress.done }} de {{ lib.progress.total }}</p>
    <p v-if="lib.error" class="rp-banner rp-banner-error">{{ lib.error }}</p>

    <div v-if="lib.loaded && !lib.tracks.length && !lib.scanning" class="rp-empty">
      <span class="rp-empty-icon"><i class="rp-i rp-i-folder" aria-hidden="true"></i></span>
      <p v-if="lib.roots.length"><strong>No hay música en tus carpetas.</strong><br />
        <span class="rp-muted">Miro en {{ lib.roots.join(', ') }}.</span></p>
      <p v-else><strong>Elige dónde tienes tu música</strong> y aparecerá aquí, por artistas y discos.</p>
      <button class="rp-btn rp-primary" @click="addFolder"><i class="rp-i rp-i-folder-add" aria-hidden="true"></i> Añadir una carpeta</button>
    </div>

    <template v-else>
      <section v-if="recent.length" class="rp-section">
        <h2 class="rp-h2 rp-search-sec">Escuchado hace poco <a href="#" @click.prevent="go({ v: 'recent' })">Ver todo</a></h2>
        <SongList :songs="recent" covers />
      </section>

      <section v-if="added.length" class="rp-section">
        <h2 class="rp-h2 rp-search-sec">Añadido hace poco <a href="#" @click.prevent="go({ v: 'albums' })">Todos los discos</a></h2>
        <div class="rp-grid"><DeviceAlbumCard v-for="a in added" :key="a.key" :album="a" /></div>
      </section>

      <section v-if="top.length" class="rp-section">
        <h2 class="rp-h2">Lo que más escuchas</h2>
        <SongList :songs="top.map((t) => t.song)" covers :extra="(_s, i) => `${top[i].count} ${top[i].count === 1 ? 'vez' : 'veces'}`" />
      </section>

      <section v-if="artists.length" class="rp-section">
        <h2 class="rp-h2 rp-search-sec">Tus artistas <a href="#" @click.prevent="go({ v: 'artists' })">Ver todos</a></h2>
        <div class="rp-grid rp-grid-artists">
          <a v-for="a in artists" :key="a.name" href="#" class="rp-artist-card" @click.prevent="go({ v: 'lartist', name: a.name })">
            <img v-if="a.cover" :src="device!.cover(a.cover)!" alt="" loading="lazy" />
            <span v-else class="rp-artist-none"><i class="rp-i rp-i-artist" aria-hidden="true"></i></span>
            <strong class="rp-ellipsis">{{ a.name }}</strong>
            <small class="rp-muted">{{ a.tracks.length }} {{ a.tracks.length === 1 ? 'canción' : 'canciones' }}</small>
          </a>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { recentSongs, topSongs } from '../lib/mine'
import { useStore } from '../lib/store'
import DeviceAlbumCard from './DeviceAlbumCard.vue'
import SongList from './SongList.vue'

/** Home without a server: what you listened to lately, what came in lately, your most played and your artists. */
const { device, go, notify } = useStore()
const lib = device!.state
const hour = new Date().getHours()
const greeting = hour < 6 ? 'Buenas noches' : hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches'

const recent = computed(() => recentSongs(6))
const top = computed(() => topSongs(6).filter((t) => t.count > 1))
const added = computed(() => (lib.tracks, [...device!.albums].sort((a, b) => b.added - a.added).slice(0, 12)))
const artists = computed(() => (lib.tracks, [...device!.artists].sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 12)))

async function addFolder() {
  try { if (await device!.backend.addRoot()) notify('Leyendo la carpeta…') } catch (err: any) { notify(err?.message || String(err), true) }
}
</script>
