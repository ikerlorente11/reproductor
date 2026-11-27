<template>
  <div class="rp-sound">
    <h2>Sonido</h2>
    <label class="rp-toggle">
      <span class="rp-toggle-text">
        <strong>Igualar el volumen</strong>
        <small class="rp-muted">Todas las canciones suenan igual de fuerte, sin tener que tocar el volumen entre una y otra.</small>
      </span>
      <input v-model="sound.normalize" class="rp-switch-input" type="checkbox" role="switch" />
    </label>
    <label class="rp-toggle">
      <span class="rp-toggle-text">
        <strong>Quitar los silencios</strong>
        <small class="rp-muted">Sin silencios al principio y al final de cada canción. Entre canciones seguidas del mismo disco se dejan, para los discos que van de una canción a otra sin pausa.</small>
      </span>
      <input v-model="sound.trim" class="rp-switch-input" type="checkbox" role="switch" />
    </label>

    <div class="rp-toggle rp-boost">
      <span class="rp-toggle-text">
        <strong>Volumen extra</strong>
        <small class="rp-muted">Más fuerte que el máximo, para altavoces flojos o canciones bajas. Un limitador evita que distorsione.</small>
      </span>
      <input v-model.number="sound.boost" class="rp-boost-slider" type="range" min="0" max="12" step="1" aria-label="Volumen extra" />
      <small class="rp-boost-n">{{ sound.boost ? `+${sound.boost} dB` : 'No' }}</small>
    </div>

    <label v-if="sinks.length" class="rp-toggle">
      <span class="rp-toggle-text">
        <strong>Salida</strong>
        <small class="rp-muted">Por dónde suena, sin cambiarlo en el sistema.</small>
      </span>
      <select v-model="sound.sink" class="rp-input rp-sink" aria-label="Salida de audio">
        <option value="">La del sistema</option>
        <option v-for="o in sinks" :key="o.id" :value="o.id">{{ o.name }}</option>
      </select>
    </label>
    <div v-else-if="locked" class="rp-toggle">
      <span class="rp-toggle-text">
        <strong>Salida</strong>
        <small class="rp-muted">Para elegir por dónde suena (altavoces, cascos…), el sistema da sus nombres solo si se permite el micrófono.
          No se graba nada: se suelta al momento.<template v-if="refused"> No se permitió.</template></small>
      </span>
      <button class="rp-btn" :disabled="asking" @click="unlock"><span v-if="asking" class="rp-spin"></span> Ver mis salidas</button>
    </div>


    <p v-if="shared" class="rp-muted rp-tiny"><i class="rp-i rp-i-devices" aria-hidden="true"></i> Igualar el volumen y quitar los silencios son los mismos en todos tus dispositivos; el volumen extra y la salida, de cada uno.</p>
    <p class="rp-muted rp-tiny">Cada canción se mide la primera vez que suena en este dispositivo (o mientras suena la anterior).</p>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { outputs, sound, unlockOutputs } from '../lib/player'
import { prefsShared } from '../lib/prefs'

/** The sound's settings, for each app's Ajustes (player.ts's `sound`, eq.ts): normalise the volume, skip the silences,
 *  raise it beyond the maximum and the output (where the app can choose it). The equaliser is EqualizerPanel. */
/** with a server, some of these are the same on every device (prefs.ts) */
const shared = prefsShared
const sinks = ref<{ id: string; name: string }[]>([])
const locked = ref(false)
async function load() {
  const o = await outputs().catch(() => ({ list: [], locked: false }))
  sinks.value = o.list
  locked.value = o.locked
}
const asking = ref(false)
const refused = ref(false)
async function unlock() {
  asking.value = true
  refused.value = !(await unlockOutputs())
  asking.value = false
  await load()
}
onMounted(() => {
  load()
  navigator.mediaDevices?.addEventListener?.('devicechange', load)
})
onBeforeUnmount(() => navigator.mediaDevices?.removeEventListener?.('devicechange', load))
</script>
