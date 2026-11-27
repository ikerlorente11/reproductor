/**
 * The player's settings the same on every device of the user (connected to their server): the sound (normalise, skip
 * the silences), the equaliser (its general setting), the radio, the quality with wifi and the speed. What belongs to
 * each device stays on it: the output chosen and each output's equaliser, the extra volume (its speakers'), the quality
 * with mobile data (a phone's), the window, the theme.
 *
 * The latest change wins: each device keeps when its settings last changed; on connecting (and coming back to the app)
 * it asks the server's, and takes them if newer or sends its own if they are. A change here is sent a moment later.
 */
import { ref, watch } from 'vue'
import type { Api } from './api.ts'
import { eq, MAX_DB, PRESETS } from './eq.ts'
import { player, radio, setRate, sound } from './player.ts'
import { QUALITIES, quality, type Quality } from './quality.ts'

const UPDATED = 'reproductor.prefs.updated'
/** when this device's settings last changed (seconds since 1970; 0: never since this was shared) */
let updated = 0
try { updated = Number(localStorage.getItem(UPDATED) || 0) } catch (_) {}
const setUpdated = (t: number) => { updated = t; try { localStorage.setItem(UPDATED, String(t)) } catch (_) {} }

/** What is shared, as it is now. */
function collect() {
  return {
    sound: { normalize: sound.normalize, trim: sound.trim },
    eq: { on: eq.all.on, preset: eq.all.preset, custom: [...eq.all.custom] },
    radio: radio.on,
    quality: { wifi: quality.wifi },
    rate: player.rate
  }
}
/** Takes another device's (what it does not know or is not valid, left as it is). */
function apply(p: Record<string, any>) {
  applying = true
  try {
    if (p.sound) {
      if (typeof p.sound.normalize === 'boolean') sound.normalize = p.sound.normalize
      if (typeof p.sound.trim === 'boolean') sound.trim = p.sound.trim
    }
    if (p.eq) {
      if (typeof p.eq.on === 'boolean') eq.all.on = p.eq.on
      if (p.eq.preset === 'custom' || PRESETS.some((x) => x.key === p.eq.preset)) eq.all.preset = p.eq.preset
      if (Array.isArray(p.eq.custom) && p.eq.custom.length === eq.all.custom.length) {
        eq.all.custom = p.eq.custom.map((v: unknown) => Math.max(-MAX_DB, Math.min(MAX_DB, Math.round(Number(v) || 0))))
      }
    }
    if (typeof p.radio === 'boolean') radio.on = p.radio
    if (QUALITIES.some((q) => q.key === p.quality?.wifi)) quality.wifi = p.quality.wifi as Quality
    if (typeof p.rate === 'number' && p.rate !== player.rate) setRate(p.rate)
  } finally {
    // the watcher sees the change after this: it must not take it for one made here
    setTimeout(() => { applying = false })
  }
}
let applying = false

let api: Api | null = null
/** they are being shared now (Ajustes says which are) */
export const prefsShared = ref(false)
let sendTimer: ReturnType<typeof setTimeout> | null = null
let lastAsked = 0
const stops: (() => void)[] = []

async function send() {
  if (!api) return
  try {
    const r = await api.putPrefs(collect(), updated)
    // newer ones were there (another device changed them meanwhile): those
    if (!r.kept && r.updated > updated) { apply(r.prefs); setUpdated(r.updated) }
  } catch (_) { /* sent again with the next change, or on coming back */ }
}
/** The server's: newer, taken; older (this device changed them since), this device's sent. */
async function sync() {
  if (!api) return
  lastAsked = Date.now()
  try {
    const r = await api.prefs()
    if (r.updated > updated) { apply(r.prefs); setUpdated(r.updated) }
    else if (updated > r.updated) await send()
    // neither has ever changed them since this was shared: this device's become the account's (any later change wins)
    else if (!r.updated && !updated) { setUpdated(1); await send() }
  } catch (_) {}
}

/** Starts sharing them with the server (connected); gives back how to stop. */
export function startPrefs(server: Api): () => void {
  stopPrefs()
  api = server
  prefsShared.value = true
  stops.push(watch(() => JSON.stringify(collect()), () => {
    if (applying) return
    setUpdated(Date.now() / 1000)
    if (sendTimer) clearTimeout(sendTimer)
    sendTimer = setTimeout(send, 1500)
  }))
  // coming back to the app (another device may have changed them meanwhile)
  if (typeof document !== 'undefined') {
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastAsked > 30000) sync() }
    document.addEventListener('visibilitychange', onVisible)
    stops.push(() => document.removeEventListener('visibilitychange', onVisible))
  }
  sync()
  return stopPrefs
}
export function stopPrefs() {
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null }
  stops.splice(0).forEach((s) => s())
  api = null
  prefsShared.value = false
}
