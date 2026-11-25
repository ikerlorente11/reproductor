<template>
  <section class="rp-page">
    <header class="rp-page-head"><h1 class="rp-h1">Descargas</h1></header>
    <p v-if="!d.active.length && !d.failed.length && !d.recent.length" class="rp-muted">
      Nada bajando ahora mismo. Lo que pidas (seguir a un artista, ↓ en un disco o una canción) aparecerá aquí con su progreso.
    </p>

    <section v-if="d.active.length" class="rp-section">
      <h2 class="rp-h2">Bajando <small class="rp-muted">{{ d.active.length }}</small></h2>
      <ul class="rp-dl">
        <li v-for="r in d.active" :key="r.release_id">
          <img v-if="r.cover" :src="r.cover" alt="" class="rp-entry-pic" loading="lazy" />
          <span v-else class="rp-entry-pic rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
          <span class="rp-dl-main">
            <a href="#" class="rp-ellipsis" @click.prevent="open(r)"><strong>{{ r.title }}</strong></a>
            <small class="rp-muted rp-ellipsis">{{ [r.artist_name, kindLabel(r.kind)].filter(Boolean).join(' · ') }}</small>
            <span v-if="r.status === 'downloading'" class="rp-dl-bar" :title="downloadState(r).text"><i :style="{ width: (downloadState(r).pct ?? 3) + '%' }"></i></span>
          </span>
          <span v-if="r.status === 'downloading'" class="rp-dl-state"><span class="rp-spin"></span> {{ downloadState(r).text }}</span>
          <span v-else class="rp-badge rp-badge-wanted">{{ downloadState(r).text }}</span>
          <button class="rp-mini" title="Cancelar la descarga" aria-label="Cancelar la descarga" :disabled="cancelling.has(r.release_id)" @click="cancel(r)">
            <i class="rp-i rp-i-close" aria-hidden="true"></i>
          </button>
        </li>
      </ul>
      <p v-if="d.waiting" class="rp-muted rp-small">Y {{ d.waiting }} más esperando a que se conecte la nube o a un reintento.</p>
    </section>

    <section v-if="d.failed.length" class="rp-section">
      <h2 class="rp-h2">No se pudieron bajar <small class="rp-muted">{{ d.failed.length }}</small></h2>
      <ul class="rp-dl">
        <li v-for="r in d.failed" :key="r.release_id">
          <img v-if="r.cover" :src="r.cover" alt="" class="rp-entry-pic" loading="lazy" />
          <span v-else class="rp-entry-pic rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
          <span class="rp-dl-main">
            <a href="#" class="rp-ellipsis" @click.prevent="open(r)"><strong>{{ r.title }}</strong></a>
            <small class="rp-muted rp-ellipsis">{{ [r.artist_name, r.error].filter(Boolean).join(' · ') }}</small>
          </span>
          <button class="rp-btn rp-small" @click="retry(r)">Reintentar</button>
        </li>
      </ul>
    </section>

    <section v-if="d.recent.length" class="rp-section">
      <h2 class="rp-h2">Terminadas hoy</h2>
      <ul class="rp-dl">
        <li v-for="r in d.recent" :key="r.release_id">
          <img v-if="r.cover" :src="r.cover" alt="" class="rp-entry-pic" loading="lazy" />
          <span v-else class="rp-entry-pic rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
          <span class="rp-dl-main">
            <a href="#" class="rp-ellipsis" @click.prevent="open(r)"><strong>{{ r.title }}</strong></a>
            <small class="rp-muted rp-ellipsis">{{ [r.artist_name, ago(r.updated), r.result?.failed ? `${r.result.failed} sin bajar` : ''].filter(Boolean).join(' · ') }}</small>
          </span>
          <span class="rp-badge rp-badge-done">Descargado</span>
        </li>
      </ul>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import { ask } from '../lib/ask'
import type { Release } from '../lib/api'
import { albumOf, downloadState, kindLabel } from '../lib/library'
import { useStore } from '../lib/store'

const { api, state, go, notify, refreshDownloads, where } = useStore()
const d = computed(() => state.downloads)

function ago(t?: number) {
  if (!t) return ''
  const min = Math.round((Date.now() / 1000 - t) / 60)
  return min < 1 ? 'ahora' : min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`
}
function open(r: Release) {
  const id = albumOf(r)
  if (id > 0) go({ v: 'release', id })
}
const cancelling = reactive(new Set<number>())
async function cancel(r: Release) {
  if (r.status === 'downloading' && !(await ask(`¿Cancelar «${r.title}»? Lo que ya se haya bajado se queda en ${where}.`, 'Cancelar la descarga', true))) return
  cancelling.add(r.release_id)
  try {
    await api.choose(r.release_id, 'cancel')
    notify(`Cancelado «${r.title}».`)
    await refreshDownloads()
  } catch (err: any) {
    notify(err?.message || String(err), true)
  } finally {
    cancelling.delete(r.release_id)
  }
}
async function retry(r: Release) {
  try { await api.choose(r.release_id, 'download'); await refreshDownloads() } catch (err: any) { notify(err?.message || String(err), true) }
}
</script>
