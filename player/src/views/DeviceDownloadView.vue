<template>
  <section class="rp-page">
    <header class="rp-page-head"><h1 class="rp-h1">Descargar música</h1></header>
    <p v-if="!status" class="rp-muted"><span class="rp-spin"></span> Cargando…</p>
    <div v-else-if="!status.installed" class="rp-empty">
      <span class="rp-empty-icon"><i class="rp-i rp-i-download" aria-hidden="true"></i></span>
      <p><strong>Busca artistas, discos y canciones, aunque no los tengas, y bájalos a este equipo.</strong><br />
        Sigue a tus artistas y lo que saquen llegará solo; haz listas que se completan solas. Se elige siempre la mejor
        versión (sin directos, versiones ni grabaciones malas), con sus etiquetas y su portada.</p>
      <p class="rp-muted rp-small">Hace falta el motor de descargas, que se instala aparte<template v-if="engine.state.latest"> ({{ fmtBytes(engine.state.latest.size) }})</template>.
        Todo ocurre en este equipo.</p>
      <template v-if="engine.state.installing">
        <span class="rp-dl-bar rp-engine-bar"><i :style="{ width: pct + '%' }"></i></span>
        <p class="rp-muted rp-small">Descargando el motor… {{ engine.state.progress.total ? `${fmtBytes(engine.state.progress.done)} de ${fmtBytes(engine.state.progress.total)}` : '' }}</p>
      </template>
      <button v-else class="rp-btn rp-primary" @click="engine.install()"><i class="rp-i rp-i-download" aria-hidden="true"></i> Instalar el motor de descargas</button>
      <p v-if="engine.state.error" class="rp-banner rp-banner-error">{{ engine.state.error }}</p>
    </div>
    <p v-else-if="engine.state.error" class="rp-banner rp-banner-error">{{ engine.state.error }}</p>
    <p v-else class="rp-muted"><span class="rp-spin"></span> Arrancando el motor de descargas…</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { fmtBytes } from '../lib/engine'
import { useStore } from '../lib/store'

/** Without the engine yet: what it gives and installing it. Once it runs, the app is El Reproductor as on the
 *  server (the host starts it and shows its pages: Buscar, artists, Descargas…). */
const { engine: maybeEngine } = useStore()
const engine = maybeEngine!
const status = computed(() => engine.state.status)
const pct = computed(() => { const p = engine.state.progress; return p.total ? Math.round((100 * p.done) / p.total) : 2 })
onMounted(async () => {
  const s = await engine.refresh().catch(() => null)
  if (s && !s.installed) engine.findLatest()
})
</script>
