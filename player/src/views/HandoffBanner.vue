<template>
  <p v-if="offer && song" class="rp-strip rp-handoff" role="status">
    <i class="rp-i rp-i-play" aria-hidden="true"></i>
    <span class="rp-grow">Suena <strong>«{{ song.title }}»</strong><template v-if="song.artist"> de {{ song.artist }}</template>
      en {{ offer.name || 'otro dispositivo' }}</span>
    <button class="rp-btn rp-small rp-primary" :disabled="busy" @click="go">Escuchar aquí</button>
    <button class="rp-mini" title="No, gracias" aria-label="Cerrar el aviso" @click="declineOffer"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
  </p>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { declineOffer, handoff, takeOffer } from '../lib/handoff'
import { player } from '../lib/player'
import { useStore } from '../lib/store'

/** «Suena X en el móvil · Escuchar aquí»: what another device is playing right now, to bring here. */
const { notify } = useStore()
const offer = computed(() => handoff.offer)
const song = computed(() => offer.value?.session.queue[offer.value.session.index] || null)
const busy = ref(false)
async function go() {
  busy.value = true
  try {
    if (!(await takeOffer()) && player.error) notify(player.error, true)
  } finally { busy.value = false }
}
</script>
