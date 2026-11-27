<template>
  <div class="rp-eq">
    <label class="rp-toggle">
      <span class="rp-toggle-text">
        <strong>Usar el ecualizador</strong>
        <small class="rp-muted">{{ s.on ? presetName : 'Apagado: la música suena tal cual.' }}<template v-if="eq.perOutput && eq.output.name"> · para {{ eq.output.name }}</template></small>
      </span>
      <input v-model="s.on" class="rp-switch-input" type="checkbox" role="switch" />
    </label>

    <div :class="['rp-eq-body', { off: !s.on }]">
      <div class="rp-chips rp-eq-presets" role="radiogroup" aria-label="Ajuste del ecualizador">
        <button v-for="p in PRESETS" :key="p.key" :class="['rp-chip', { on: s.preset === p.key }]" role="radio" :aria-checked="s.preset === p.key"
                @click="choose(p.key)">{{ p.name }}</button>
        <button :class="['rp-chip', { on: s.preset === 'custom' }]" role="radio" :aria-checked="s.preset === 'custom'" @click="choose('custom')">Personalizado</button>
      </div>
      <div class="rp-eq-bands">
        <label v-for="(hz, i) in BANDS" :key="hz" class="rp-eq-band">
          <small class="rp-eq-db">{{ fmtDb(shown[i]) }}</small>
          <input class="rp-eq-slider" type="range" :min="-MAX_DB" :max="MAX_DB" step="1" :value="shown[i]" :aria-label="`${fmtHz(hz)}`"
                 @input="setBand(i, ($event.target as HTMLInputElement).valueAsNumber)" @dblclick="setBand(i, 0)" />
          <small class="rp-muted">{{ fmtHz(hz) }}</small>
        </label>
      </div>
      <p class="rp-muted rp-tiny">Mueve las barras para hacer el tuyo (doble clic: a cero). Lo que se pasa de fuerte lo frena un limitador, sin distorsionar.</p>
    </div>

    <label class="rp-toggle">
      <span class="rp-toggle-text">
        <strong>Un ajuste para cada salida</strong>
        <small class="rp-muted">Los altavoces, los cascos, cada aparato Bluetooth… con el suyo, que cambia solo al cambiar de salida.</small>
      </span>
      <input v-model="eq.perOutput" class="rp-switch-input" type="checkbox" role="switch" />
    </label>
    <p v-if="shared" class="rp-muted rp-tiny"><i class="rp-i rp-i-devices" aria-hidden="true"></i> El ecualizador es el mismo en todos tus dispositivos; el de cada salida, de cada uno.</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BANDS, eq, MAX_DB, PRESETS, setBand, setting } from '../lib/eq'
import { prefsShared } from '../lib/prefs'

/** The equaliser's settings (eq.ts): on or off, a preset or one's own ten bands, and one setting for each output. */
const s = computed(() => setting.value)
/** with a server, some of these are the same on every device (prefs.ts) */
const shared = prefsShared
const shown = computed(() => (s.value.preset === 'custom' ? s.value.custom : PRESETS.find((p) => p.key === s.value.preset)?.bands || s.value.custom))
const presetName = computed(() => (s.value.preset === 'custom' ? 'Personalizado' : PRESETS.find((p) => p.key === s.value.preset)?.name || ''))
function choose(key: string) {
  s.value.preset = key
  s.value.on = true
}
const fmtHz = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz))
const fmtDb = (db: number) => (db > 0 ? `+${db}` : String(db))
</script>
