<template>
  <span ref="root" class="rp-pm">
    <button :class="[buttonClass, { on: active }]" :title="title" aria-label="Temporizador y velocidad" :aria-expanded="open" @click.stop="open = !open">
      <i class="rp-i rp-i-sleep" aria-hidden="true"></i><span v-if="badge" class="rp-pm-badge">{{ badge }}</span>
    </button>
    <!-- a phone: the menu is a sheet from the bottom; touching outside it closes it -->
    <div v-if="open" class="rp-menu-backdrop" @click.stop="open = false"></div>
    <div v-if="open" :class="['rp-menu', 'rp-pm-menu', { up }]" role="dialog" aria-label="Temporizador y velocidad" @click.stop>
      <p class="rp-menu-head rp-small"><strong>Temporizador</strong> <span v-if="active" class="rp-muted">· {{ leftText }}</span></p>
      <div class="rp-chips rp-pm-chips">
        <button v-for="m in MINUTES" :key="m" class="rp-chip" @click="sleep(m)">{{ m < 60 ? `${m} min` : `${String(m / 60).replace('.', ',')} h` }}</button>
        <button :class="['rp-chip', { on: player.sleepSong }]" @click="sleep('song')">Al acabar la canción</button>
        <button v-if="active" class="rp-chip" @click="sleep(null)">Desactivar</button>
      </div>
      <p class="rp-menu-head rp-small"><strong>Velocidad</strong></p>
      <div class="rp-chips rp-pm-chips">
        <button v-for="r in RATES" :key="r" :class="['rp-chip', { on: player.rate === r }]" @click="setRate(r)">{{ rateText(r) }}</button>
      </div>
    </div>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { player, setRate, setSleep, sleepLeft } from '../lib/player'

/**
 * The sleep timer and the speed, behind one button of the player (the bar on a wide screen, the phone's player): it
 * stops in a while or at the end of the song (fading out), and plays faster or slower. The button says how long is left,
 * or the speed when it is not the usual one. `up`: the menu opens above the button (a bar at the bottom of the screen).
 */
const props = withDefaults(defineProps<{ buttonClass?: string; up?: boolean }>(), { buttonClass: 'rp-pbtn', up: true })
void props

const MINUTES = [15, 30, 45, 60, 90]
const RATES = [0.75, 1, 1.25, 1.5, 2]
const rateText = (r: number) => `${String(r).replace('.', ',')}×`

const open = ref(false)
const root = ref<HTMLElement>()
const active = computed(() => !!player.sleepAt || player.sleepSong)

// what is left, counted down while the timer is on
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
watch(active, (on) => {
  if (ticker) { clearInterval(ticker); ticker = null }
  if (on) ticker = setInterval(() => { now.value = Date.now() }, 1000)
}, { immediate: true })
const left = computed(() => { void now.value; void player.time; return active.value ? sleepLeft() : null })
const minutesLeft = computed(() => (left.value === null ? null : Math.max(1, Math.ceil(left.value / 60))))
const leftText = computed(() => {
  if (player.sleepSong) return 'al acabar la canción'
  const s = Math.max(0, Math.round(left.value || 0))
  return s >= 60 ? `para en ${Math.ceil(s / 60)} min` : `para en ${s} s`
})
const badge = computed(() => (active.value ? (player.sleepSong ? '♪' : `${minutesLeft.value}′`) : player.rate !== 1 ? rateText(player.rate) : ''))
const title = computed(() => {
  const parts = [active.value ? `Temporizador: ${leftText.value}` : 'Temporizador para dormir']
  parts.push(`velocidad ${rateText(player.rate)}`)
  return parts.join(' · ')
})

function sleep(when: number | 'song' | null) {
  setSleep(when)
  open.value = false
}

// a click anywhere else closes it
function outside(e: MouseEvent) { if (!root.value?.contains(e.target as Node)) open.value = false }
watch(open, (on) => {
  if (on) document.addEventListener('click', outside, true)
  else document.removeEventListener('click', outside, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', outside, true)
  if (ticker) clearInterval(ticker)
})
</script>
