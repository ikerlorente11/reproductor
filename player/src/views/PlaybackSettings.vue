<template>
  <div class="rp-sound">
    <h2>Reproducción</h2>
    <label class="rp-toggle">
      <span class="rp-toggle-text">
        <strong>Radio al acabar la cola</strong>
        <small class="rp-muted">En vez de quedarse en silencio, sigue con canciones parecidas que tienes: de los mismos artistas<template v-if="related"> y de los que Deezer relaciona con ellos</template>, sin repetir lo que has escuchado hace poco.</small>
      </span>
      <input v-model="radio.on" class="rp-switch-input" type="checkbox" role="switch" />
    </label>

    <div class="rp-quality">
      <span class="rp-toggle-text">
        <strong>Calidad{{ phone ? ' con wifi' : '' }}</strong>
        <small class="rp-muted">De Navidrome y Jellyfin: más baja gasta menos datos. Tu nube y lo guardado en el dispositivo suenan siempre en original (el servidor no las recodifica).</small>
      </span>
      <div class="rp-chips rp-eq-presets" role="radiogroup" aria-label="Calidad">
        <button v-for="q in QUALITIES" :key="q.key" :class="['rp-chip', { on: quality.wifi === q.key }]" role="radio" :aria-checked="quality.wifi === q.key"
                :title="q.note" @click="quality.wifi = q.key">{{ q.name }}<small v-if="q.kbps" class="rp-muted rp-q-kbps">{{ q.kbps }}</small></button>
      </div>
    </div>
    <div v-if="phone" class="rp-quality">
      <span class="rp-toggle-text">
        <strong>Calidad con datos móviles</strong>
        <small class="rp-muted">La que se usa cuando el móvil no tiene wifi.</small>
      </span>
      <div class="rp-chips rp-eq-presets" role="radiogroup" aria-label="Calidad con datos móviles">
        <button v-for="q in QUALITIES" :key="q.key" :class="['rp-chip', { on: quality.mobile === q.key }]" role="radio" :aria-checked="quality.mobile === q.key"
                :title="q.note" @click="quality.mobile = q.key">{{ q.name }}<small v-if="q.kbps" class="rp-muted rp-q-kbps">{{ q.kbps }}</small></button>
      </div>
    </div>
    <p v-if="shared" class="rp-muted rp-tiny"><i class="rp-i rp-i-devices" aria-hidden="true"></i> La radio, la calidad con wifi y la velocidad son las mismas en todos tus dispositivos; la calidad con datos móviles, de cada uno.</p>
  </div>
</template>

<script setup lang="ts">
import { isPhone as phone } from '../lib/phone'
import { radio } from '../lib/player'
import { quality, QUALITIES } from '../lib/quality'
import { useStore } from '../lib/store'
import { prefsShared } from '../lib/prefs'

/** How it plays, for each app's Ajustes: the radio when the queue ends (player.ts) and the servers' quality (quality.ts). */
const { openFetch } = useStore()
/** with a server, these are the same on every device (prefs.ts) */
const shared = prefsShared
/** the app can ask Deezer for related artists (not the web) */
const related = !!openFetch
</script>
