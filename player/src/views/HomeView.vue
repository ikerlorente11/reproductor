<template>
  <section class="rp-page">
    <header class="rp-page-head">
      <h1 class="rp-h1">{{ greeting }}</h1>
      <span class="rp-grow"></span>
      <button v-if="state.follows.length" class="rp-btn" :disabled="checking" title="Mirar ya si tus artistas han sacado algo" @click="checkNow">
        <span v-if="checking" class="rp-spin"></span> <i class="rp-i rp-i-refresh" aria-hidden="true"></i> Buscar novedades
      </button>
    </header>

    <div v-if="state.loaded && !state.follows.length" class="rp-empty">
      <span class="rp-empty-icon"><i class="rp-i rp-i-music" aria-hidden="true"></i></span>
      <p><strong>Sigue a tus artistas</strong> y su música se bajará sola a {{ where }}, también lo que saquen a partir de ahora.</p>
      <button class="rp-btn rp-primary" @click="go({ v: 'search' })"><i class="rp-i rp-i-search" aria-hidden="true"></i> Buscar artistas</button>
    </div>

    <template v-else>
      <a v-if="totals.downloading || totals.wanted || totals.checking" href="#" class="rp-strip" title="Ver las descargas" @click.prevent="go({ v: 'downloads' })">
        <span class="rp-spin"></span>
        <span>
          <template v-if="totals.downloading">Bajando {{ totals.downloading }} {{ totals.downloading === 1 ? 'disco' : 'discos' }}</template>
          <template v-if="totals.downloading && totals.wanted"> · </template>
          <template v-if="totals.wanted">{{ totals.wanted }} en espera</template>
          <template v-if="totals.checking"><template v-if="totals.downloading || totals.wanted"> · </template>buscando los discos de {{ totals.checking }} {{ totals.checking === 1 ? 'artista' : 'artistas' }}</template>
        </span>
      </a>

      <section v-if="failed.length" class="rp-section">
        <h2 class="rp-h2">No se pudieron bajar</h2>
        <div class="rp-grid">
          <ReleaseCard v-for="r in failed" :key="r.release_id" :release="r" show-artist @open="go({ v: 'release', id: albumOf(r) })">
            <button class="rp-btn rp-small" @click="retry(r)">Reintentar</button>
          </ReleaseCard>
        </div>
      </section>

      <FavoriteCards />

      <!-- before anything was listened to, what came in last -->
      <section v-if="!hasFavorites" class="rp-section">
        <h2 class="rp-h2">Lo último en tu biblioteca</h2>
        <p v-if="loading" class="rp-muted"><span class="rp-spin"></span> Cargando…</p>
        <p v-else-if="!recent.length" class="rp-muted">Aún no ha terminado de bajarse ningún disco. Aparecerán aquí según vayan llegando.</p>
        <div v-else class="rp-grid">
          <ReleaseCard v-for="r in recent" :key="r.release_id" :release="r" show-artist :badge="false"
                       @open="go({ v: 'release', id: albumOf(r) })" @play="playRelease(r)" />
        </div>
      </section>

      <section v-if="top.length" class="rp-section">
        <h2 class="rp-h2">Tus canciones más escuchadas</h2>
        <SongList :songs="top.map((t) => t.song)" covers :extra="(_s, i) => `${top[i].count} ${top[i].count === 1 ? 'vez' : 'veces'}`" />
      </section>

      <section v-if="state.follows.length" class="rp-section">
        <h2 class="rp-h2">Tus artistas</h2>
        <div class="rp-grid rp-grid-artists">
          <a v-for="f in state.follows" :key="f.artist_id" href="#" class="rp-artist-card" @click.prevent="go({ v: 'artist', id: f.artist_id })">
            <img v-if="f.picture" :src="f.picture" alt="" loading="lazy" />
            <span v-else class="rp-artist-none"><i class="rp-i rp-i-artist" aria-hidden="true"></i></span>
            <strong class="rp-ellipsis">{{ f.name }}</strong>
            <small class="rp-muted">{{ (f.counts.done || 0) }} {{ f.counts.done === 1 ? 'disco' : 'discos' }}</small>
          </a>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Release } from '../lib/api'
import { albumOf, releaseSongs } from '../lib/library'
import { play } from '../lib/player'
import { useStore } from '../lib/store'
import { mine, topFavorites } from '../lib/mine'
import FavoriteCards from './FavoriteCards.vue'
import ReleaseCard from './ReleaseCard.vue'
import SongList from './SongList.vue'
import type { Song } from '../lib/library'

const { api, state, go, notify, refreshFollows, where } = useStore()
const recent = ref<Release[]>([])
const failed = ref<Release[]>([])
const loading = ref(true)
/** the songs listened to most, on any of the user's devices (the server keeps it) */
const top = ref<{ song: Song; count: number }[]>([])
/** the lists and artists listened to most (FavoriteCards); till there are some, what came in last shows instead */
const hasFavorites = computed(() => topFavorites(mine.favorites).length > 0)
async function loadPlays() {
  try {
    top.value = (await api.topPlays(5)).filter((x) => x.count > 1)
  } catch (_) { /* an older server has no history: the section just does not show */ }
}
const checking = ref(false)

const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'
})
const totals = computed(() => ({
  downloading: state.downloads.active.filter((r) => r.status === 'downloading').length,
  wanted: state.downloads.active.filter((r) => r.status === 'wanted').length,
  checking: state.follows.filter((f) => f.checked === null).length
}))

async function load() {
  if (!state.connected) return
  try {
    const [done, bad] = await Promise.all([api.releases({ status: 'done', recent: true, limit: 24 }), api.releases({ status: 'failed' })])
    recent.value = done
    failed.value = bad
  } catch (err: any) {
    notify(`No se pudo cargar tu biblioteca: ${err?.message || err}`, true)
  } finally {
    loading.value = false
  }
}
async function checkNow() {
  checking.value = true
  try {
    const { checking: n } = await api.checkNow()
    notify(`Buscando novedades de ${n} ${n === 1 ? 'artista' : 'artistas'}…`)
    await refreshFollows()
  } catch (err: any) { notify(err?.message || String(err), true) } finally { checking.value = false }
}
async function retry(r: Release) {
  try { await api.choose(r.release_id, 'download'); await Promise.all([load(), refreshFollows()]) } catch (err: any) { notify(err?.message || String(err), true) }
}
function playRelease(r: Release) {
  const songs = releaseSongs(r)
  if (songs.length) play(songs, null, false)
}

// New downloads land while the page is open: reload when the counts move.
const doneCount = computed(() => state.downloads.recent.length + state.downloads.failed.length)
watch(doneCount, load)
watch(() => state.connected, load)
onMounted(() => { load(); loadPlays() })
</script>
