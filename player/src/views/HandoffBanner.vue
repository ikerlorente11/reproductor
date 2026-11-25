<template>
  <p v-if="offer && song" class="rp-strip rp-handoff" role="status">
    <i class="rp-i rp-i-play" aria-hidden="true"></i>
    <span class="rp-grow">Ibas por <strong>«{{ song.title }}»</strong><template v-if="song.artist"> de {{ song.artist }}</template>
      en {{ offer.name || 'otro dispositivo' }} · {{ ago }}</span>
    <button class="rp-btn rp-small rp-primary" :disabled="busy" @click="go">Continuar aquí</button>
    <button class="rp-mini" title="No, gracias" aria-label="Cerrar el aviso" @click="handoff.offer = null"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
  </p>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { handoff, takeOffer } from '../lib/handoff'
import { player } from '../lib/player'
import { useStore } from '../lib/store'

/** «Ibas por X en el móvil · Continuar aquí»: another device's playback, newer than this one's. */
const { notify } = useStore()
const offer = computed(() => handoff.offer)
const song = computed(() => offer.value?.session.queue[offer.value.session.index] || null)
const ago = computed(() => {
  const mins = Math.round((Date.now() / 1000 - (offer.value?.updated || 0)) / 60)
  return mins < 1 ? 'ahora mismo' : mins < 60 ? `hace ${mins} min` : mins < 1440 ? `hace ${Math.round(mins / 60)} h` : `hace ${Math.round(mins / 1440)} días`
})
const busy = ref(false)
async function go() {
  busy.value = true
  try {
    if (!(await takeOffer()) && player.error) notify(player.error, true)
  } finally { busy.value = false }
}
</script>
