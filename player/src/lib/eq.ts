/**
 * The equaliser: ten bands (32 Hz … 16 kHz), from -12 to +12 dB, with presets and one's own; and, if wanted, one
 * setting for each output (the PC's speakers, its headphones; the phone's speaker, its wired headphones, each Bluetooth
 * device), which changes by itself when the output changes. Kept on this device.
 *
 * The player hands it to its output (player.ts): the browser's with Web Audio filters, Android's with the system's
 * equaliser on ExoPlayer's audio session (with fewer bands: each takes what these say at its own frequency).
 */
import { computed, reactive, watch } from 'vue'

/** the bands' centres (Hz) */
export const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const MAX_DB = 12

export interface Preset { key: string; name: string; bands: number[] }
export const PRESETS: Preset[] = [
  { key: 'flat', name: 'Plano', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { key: 'bass', name: 'Más graves', bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { key: 'treble', name: 'Más agudos', bands: [0, 0, 0, 0, 0, 0, 1, 3, 5, 6] },
  { key: 'vocal', name: 'Voces', bands: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  { key: 'rock', name: 'Rock', bands: [5, 4, 2, -1, -2, -1, 1, 3, 4, 4] },
  { key: 'pop', name: 'Pop', bands: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2] },
  { key: 'electronic', name: 'Electrónica', bands: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5] },
  { key: 'hiphop', name: 'Hip-hop', bands: [5, 5, 2, 3, -1, -1, 1, -1, 2, 3] },
  { key: 'acoustic', name: 'Acústica', bands: [4, 3, 2, 1, 2, 2, 3, 3, 2, 1] },
  { key: 'classical', name: 'Clásica', bands: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  { key: 'loudness', name: 'Volumen bajo', bands: [6, 4, 2, 0, -1, 0, 0, 1, 3, 5] }
]

/** One output's setting: on or off, the preset chosen ('custom': one's own) and one's own bands. */
export interface EqSetting { on: boolean; preset: string; custom: number[] }
const fresh = (): EqSetting => ({ on: false, preset: 'flat', custom: BANDS.map(() => 0) })

const KEY = 'reproductor.eq'
/** what is kept: the setting for every output (`all`), or one for each (`byOutput`) */
export const eq = reactive({
  perOutput: false,
  all: fresh(),
  byOutput: {} as Record<string, EqSetting>,
  /** the output sounding now (its key and name), as the app says (only to tell the settings apart) */
  output: { key: '', name: '' }
})
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
  if (saved) {
    eq.perOutput = !!saved.perOutput
    eq.all = { ...fresh(), ...saved.all }
    eq.byOutput = saved.byOutput || {}
  }
} catch (_) {}
watch(() => [eq.perOutput, eq.all, eq.byOutput], () => {
  try { localStorage.setItem(KEY, JSON.stringify({ perOutput: eq.perOutput, all: eq.all, byOutput: eq.byOutput })) } catch (_) {}
}, { deep: true })

/** The setting in use: the one for every output, or (one for each) the current output's. */
export const setting = computed<EqSetting>(() => (eq.perOutput && eq.output.key && eq.byOutput[eq.output.key]) || eq.all)
/** an output met for the first time (with one setting for each) starts from the general one */
function ensureOutput() {
  const key = eq.output.key
  if (eq.perOutput && key && !eq.byOutput[key]) eq.byOutput[key] = { ...eq.all, custom: [...eq.all.custom] }
}
watch(() => [eq.perOutput, eq.output.key], ensureOutput, { immediate: true })

/** The bands in use (dB), or null when the equaliser is off (or flat: nothing to do). */
export const activeBands = computed<number[] | null>(() => {
  const s = setting.value
  if (!s.on) return null
  const bands = s.preset === 'custom' ? s.custom : PRESETS.find((p) => p.key === s.preset)?.bands || BANDS.map(() => 0)
  return bands.some((b) => b !== 0) ? bands.map((b) => Math.max(-MAX_DB, Math.min(MAX_DB, b))) : null
})

/** A line of how it is now (Ajustes' list): the preset, or off. */
export const eqSummary = computed(() => {
  const s = setting.value
  if (!s.on) return 'Apagado'
  const name = s.preset === 'custom' ? 'Personalizado' : PRESETS.find((p) => p.key === s.preset)?.name || ''
  return eq.perOutput && eq.output.name ? `${name} · para ${eq.output.name}` : name
})

/** The output changed (the app says which): with one setting for each, that output's comes into use. */
export function setOutput(key: string, name: string) {
  eq.output = { key, name }
}

/** A band moved by hand: one's own setting, from what was in use. */
export function setBand(i: number, db: number) {
  const s = setting.value
  if (s.preset !== 'custom') s.custom = [...(PRESETS.find((p) => p.key === s.preset)?.bands || s.custom)]
  s.preset = 'custom'
  s.custom[i] = Math.max(-MAX_DB, Math.min(MAX_DB, Math.round(db)))
  s.on = true
}
