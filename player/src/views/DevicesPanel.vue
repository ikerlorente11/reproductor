<template>
  <section class="rp-panel rp-devpanel" aria-label="Dispositivos">
    <header class="rp-panel-head">
      <span class="rp-panel-title"><small class="rp-panel-kicker">Dispositivos</small><strong>{{ connect.controlling ? `Controlando ${controlled?.name}` : 'Suena en este dispositivo' }}</strong></span>
      <button class="rp-mini" title="Cerrar" aria-label="Cerrar los dispositivos" @click="emit('close')"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
    </header>
    <div class="rp-panel-body rp-devlist">
      <button :class="['rp-dev', { on: !connect.controlling }]" @click="here">
        <i :class="['rp-i', icon(connect.me?.kind)]" aria-hidden="true"></i>
        <span class="rp-dev-text"><span class="rp-ellipsis">Este dispositivo</span><small class="rp-muted rp-ellipsis">{{ connect.me?.name }}</small></span>
        <i v-if="!connect.controlling" class="rp-i rp-i-check" aria-hidden="true"></i>
      </button>
      <div v-for="d in others" :key="d.id" :class="['rp-dev', 'rp-dev-far', { on: connect.controlling === d.id }]">
        <i :class="['rp-i', icon(d.kind)]" aria-hidden="true"></i>
        <span class="rp-dev-text">
          <span class="rp-ellipsis">{{ d.name }}</span>
          <small class="rp-muted rp-ellipsis">{{ says(d) }}</small>
          <span class="rp-dev-actions">
            <button v-if="hasHere" class="rp-btn rp-small rp-primary" title="Lo que suena aquí sigue allí, desde el mismo segundo" :disabled="busy" @click="pass(d.id)">Reproducir ahí</button>
            <button v-if="d.state?.song" class="rp-btn rp-small" title="Lo que suena allí sigue aquí" :disabled="busy" @click="bring(d.id)">Traer aquí</button>
            <button v-if="connect.controlling !== d.id && d.state?.song" class="rp-btn rp-small" title="Los botones del reproductor manejan ese dispositivo" @click="drive(d.id)">Controlar</button>
          </span>
        </span>
        <i v-if="connect.controlling === d.id" class="rp-i rp-i-check" aria-hidden="true"></i>
      </div>
      <p v-if="!others.length" class="rp-muted rp-small">
        No hay otros dispositivos con El Reproductor abierto. Ábrelo con tu cuenta en el navegador, el escritorio o el móvil y saldrán aquí.
      </p>
      <p v-else class="rp-muted rp-small">Cada dispositivo sigue con lo suyo salvo que pases, traigas o controles la reproducción.</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DeviceInfo, DeviceKind } from '../lib/api'
import { bringHere, connect, controlDevice, controlled, others, transferTo } from '../lib/connect'
import { nowPlaying } from '../lib/player'

/** The user's devices (as Spotify Connect): which one plays, pass the playback, bring it, control it. A panel in the
 *  page's place (a wide screen) or in the cover's (a phone's player); it closes once something is done. */
const emit = defineEmits<{ close: [] }>()
const busy = ref(false)
const hasHere = computed(() => !!nowPlaying.value && !connect.controlling)

const icon = (kind?: DeviceKind) => (kind === 'android' ? 'rp-i-phone' : kind === 'desktop' ? 'rp-i-computer' : 'rp-i-web')
function says(d: DeviceInfo): string {
  const s = d.state
  if (!s?.song) return 'Sin nada sonando'
  return `${s.playing ? 'Sonando' : 'En pausa'}: ${s.song.title}${s.song.artist ? ` · ${s.song.artist}` : ''}`
}
async function act(fn: () => Promise<unknown>) {
  busy.value = true
  try { await fn(); emit('close') } catch (_) { /* connect.ts told why */ } finally { busy.value = false }
}
const pass = (id: string) => act(() => transferTo(id))
const bring = (id: string) => act(() => bringHere(id))
function drive(id: string) { controlDevice(id); emit('close') }
function here() { controlDevice(''); emit('close') }
</script>
