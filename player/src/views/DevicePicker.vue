<template>
  <span ref="root" class="rp-add rp-devices">
    <button :class="['rp-pbtn', { on: !!connect.controlling || open }]" :title="connect.controlling ? `Controlando ${controlled?.name}` : 'Dispositivos'"
            aria-label="Dispositivos" :aria-expanded="open" @click.stop="toggleOpen">
      <i class="rp-i rp-i-devices" aria-hidden="true"></i><span v-if="others.length" class="rp-devcount">{{ others.length + 1 }}</span>
    </button>
    <div v-if="open" class="rp-menu rp-menu-up rp-devmenu" role="dialog" aria-label="Dispositivos" @click.stop>
      <p class="rp-menu-head rp-small"><strong>Dispositivos</strong></p>
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
            <button v-if="connect.controlling !== d.id && d.state?.song" class="rp-btn rp-small" title="La barra maneja ese dispositivo" @click="drive(d.id)">Controlar</button>
          </span>
        </span>
        <i v-if="connect.controlling === d.id" class="rp-i rp-i-check" aria-hidden="true"></i>
      </div>
      <p v-if="!others.length" class="rp-muted rp-small rp-menu-hint">
        No hay otros dispositivos con El Reproductor abierto. Ábrelo con tu cuenta en el navegador, el escritorio o el móvil y saldrán aquí.
      </p>
      <p v-else class="rp-muted rp-tiny rp-menu-hint">Cada dispositivo sigue con lo suyo salvo que pases, traigas o controles la reproducción.</p>
    </div>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { DeviceInfo, DeviceKind } from '../lib/api'
import { bringHere, connect, controlDevice, controlled, others, transferTo } from '../lib/connect'
import { nowPlaying } from '../lib/player'

/** The devices' button of the player bar (as Spotify Connect): which device plays, pass the playback, bring it, control it. */
const root = ref<HTMLElement>()
const open = ref(false)
const busy = ref(false)
const hasHere = computed(() => !!nowPlaying.value && !connect.controlling)

const icon = (kind?: DeviceKind) => (kind === 'android' ? 'rp-i-phone' : kind === 'desktop' ? 'rp-i-computer' : 'rp-i-web')
function says(d: DeviceInfo): string {
  const s = d.state
  if (!s?.song) return 'Sin nada sonando'
  return `${s.playing ? 'Sonando' : 'En pausa'}: ${s.song.title}${s.song.artist ? ` · ${s.song.artist}` : ''}`
}

function onOutside(e: MouseEvent) { if (root.value && !root.value.contains(e.target as Node)) close() }
function close() { open.value = false; document.removeEventListener('click', onOutside) }
function toggleOpen() {
  if (open.value) return close()
  open.value = true
  document.addEventListener('click', onOutside)
}
async function act(fn: () => Promise<unknown>) {
  busy.value = true
  try { await fn(); close() } catch (_) { /* connect.ts told why */ } finally { busy.value = false }
}
const pass = (id: string) => act(() => transferTo(id))
const bring = (id: string) => act(() => bringHere(id))
function drive(id: string) { controlDevice(id); close() }
function here() { controlDevice(''); close() }
onBeforeUnmount(() => document.removeEventListener('click', onOutside))
</script>
