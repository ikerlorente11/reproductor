/**
 * What each song sounds like, measured once and kept on this device: how loud it is (its integrated loudness, in LUFS,
 * as ITU-R BS.1770 / EBU R128 measure it) and where its sound starts and ends (the silence before and after it). The
 * player uses it to bring every song to the same loudness and to skip the silences at its edges.
 *
 * Measured here, in the page, the first time a song is about to play (or is coming next): the file is fetched and
 * decoded at a low rate (enough for loudness: it is weighted towards the middle frequencies) and gone through once.
 * The same in every app (the browser, the desktop's web view, the phone's), whatever the song's source. What is
 * measured is kept by the song's key (IndexedDB), so each song is measured once per device.
 */

/** A song measured: its loudness (LUFS; null: silent), where its sound starts and ends (seconds), and its length. */
export interface Analysis { lufs: number | null; start: number; end: number; duration: number }

/** the rate songs are decoded at to be measured (loudness weighs little above 8 kHz) */
const RATE = 16000
/** longer songs are not measured (decoding a whole long session at once takes too much memory) */
const MAX_SECONDS = 15 * 60
/** below this (dBFS) a stretch is silence */
const SILENCE_DB = -50
/** what is kept of the silence at the edges (seconds): a cut too close sounds abrupt */
const KEEP_BEFORE = 0.05
const KEEP_AFTER = 0.25
/** a version of the measure: changing how it is measured measures every song again */
const VERSION = 1

// ---- kept: IndexedDB (a store of the song's key → its measure), and the same in memory once read ----
const DB = 'reproductor-analysis'
const STORE = 'songs'
let db: Promise<IDBDatabase | null> | null = null
const memory = new Map<string, Analysis>()

function open(): Promise<IDBDatabase | null> {
  if (db) return db
  db = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch (_) { resolve(null) }
  })
  return db
}
async function read(key: string): Promise<Analysis | null> {
  const d = await open()
  if (!d) return null
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => { const v = req.result; resolve(v && v.v === VERSION ? v.a : null) }
      req.onerror = () => resolve(null)
    } catch (_) { resolve(null) }
  })
}
async function write(key: string, a: Analysis) {
  const d = await open()
  if (!d) return
  try { d.transaction(STORE, 'readwrite').objectStore(STORE).put({ v: VERSION, a }, key) } catch (_) {}
}

/** What is known of a song right now (without waiting): its measure if it was read or made in this run. */
export function analysisOf(key: string): Analysis | null { return memory.get(key) || null }

/** Its measure: kept, or made now (null: it could not be measured, or is too long). One song at a time. */
export function analyze(key: string, url: string, duration = 0): Promise<Analysis | null> {
  const known = memory.get(key)
  if (known) return Promise.resolve(known)
  let job = jobs.get(key)
  if (!job) {
    job = (async () => {
      const kept = await read(key)
      if (kept) { memory.set(key, kept); return kept }
      if (duration > MAX_SECONDS) return null
      const made = await queued(() => measure(url))
      if (made) { memory.set(key, made); write(key, made) }
      return made
    })().catch(() => null).finally(() => jobs.delete(key))
    jobs.set(key, job)
  }
  return job
}
const jobs = new Map<string, Promise<Analysis | null>>()
/** one measure at a time (each decodes a whole song) */
let chain: Promise<unknown> = Promise.resolve()
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => {})
  return run
}

// ---- the measure ----
async function measure(url: string): Promise<Analysis | null> {
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.arrayBuffer()
  const Ctx = (globalThis as any).OfflineAudioContext || (globalThis as any).webkitOfflineAudioContext
  if (!Ctx) return null
  // decoded at a low rate: the context resamples it
  const ctx: OfflineAudioContext = new Ctx(1, 1, RATE)
  const buffer = await ctx.decodeAudioData(data)
  if (buffer.duration > MAX_SECONDS) return null
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i))
  return { lufs: loudness(channels, buffer.sampleRate), ...edges(channels, buffer.sampleRate), duration: buffer.duration }
}

/** A second-order filter (RBJ's cookbook): `b0 b1 b2 a1 a2`, normalised. */
type Biquad = [number, number, number, number, number]
function highShelf(rate: number, f0: number, gainDb: number, q: number): Biquad {
  const A = Math.pow(10, gainDb / 40)
  const w = 2 * Math.PI * f0 / rate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * q)
  const s = 2 * Math.sqrt(A) * alpha
  const a0 = (A + 1) - (A - 1) * cos + s
  return [A * ((A + 1) + (A - 1) * cos + s) / a0, -2 * A * ((A - 1) + (A + 1) * cos) / a0, A * ((A + 1) + (A - 1) * cos - s) / a0,
          2 * ((A - 1) - (A + 1) * cos) / a0, ((A + 1) - (A - 1) * cos - s) / a0]
}
function highPass(rate: number, f0: number, q: number): Biquad {
  const w = 2 * Math.PI * f0 / rate
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * q)
  const a0 = 1 + alpha
  return [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0, -2 * cos / a0, (1 - alpha) / a0]
}

/**
 * Integrated loudness (BS.1770-4): each channel K-weighted (a shelf that lifts the highs, a cut of the lowest lows),
 * its mean square in blocks of 400 ms every 100 ms, the blocks below -70 LUFS left out, then those 10 LU below the
 * mean of the rest; what is left, averaged.
 */
export function loudness(channels: Float32Array[], rate: number): number | null {
  const shelf = highShelf(rate, 1681.97, 3.99984, 0.70717)
  const pass = highPass(rate, 38.1355, 0.50033)
  const step = Math.round(rate * 0.1)
  const steps = Math.floor(channels[0].length / step)
  if (steps < 4) return null
  // the weighted energy of each 100 ms step, all channels summed
  const energy = new Float64Array(steps)
  for (const x of channels) {
    let [s1, s2, p1, p2] = [0, 0, 0, 0]   // the filters' state (transposed direct form II)
    for (let i = 0, k = 0; k < steps; k++) {
      let sum = 0
      for (const end = i + step; i < end; i++) {
        const v = x[i]
        const y = shelf[0] * v + s1
        s1 = shelf[1] * v - shelf[3] * y + s2
        s2 = shelf[2] * v - shelf[4] * y
        const z = pass[0] * y + p1
        p1 = pass[1] * y - pass[3] * z + p2
        p2 = pass[2] * y - pass[4] * z
        sum += z * z
      }
      energy[k] += sum / step
    }
  }
  // blocks of four steps (400 ms, overlapping 75 %)
  const blocks: number[] = []
  for (let k = 0; k + 4 <= steps; k++) blocks.push((energy[k] + energy[k + 1] + energy[k + 2] + energy[k + 3]) / 4)
  const lufs = (e: number) => -0.691 + 10 * Math.log10(e)
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const loud = blocks.filter((e) => e > 0 && lufs(e) > -70)
  if (!loud.length) return null
  const relative = lufs(mean(loud)) - 10
  const gated = loud.filter((e) => lufs(e) > relative)
  return gated.length ? Math.round(lufs(mean(gated)) * 10) / 10 : null
}

/** Where the sound starts and ends: the first and last 10 ms louder than the silence threshold (a little kept around). */
export function edges(channels: Float32Array[], rate: number): { start: number; end: number } {
  const win = Math.max(1, Math.round(rate * 0.01))
  const n = channels[0].length
  const wins = Math.floor(n / win)
  const threshold = Math.pow(10, SILENCE_DB / 20) ** 2
  const loudAt = (w: number) => {
    let sum = 0
    for (const x of channels) for (let i = w * win, end = i + win; i < end; i++) sum += x[i] * x[i]
    return sum / (win * channels.length) > threshold
  }
  let first = 0
  while (first < wins && !loudAt(first)) first++
  let last = wins - 1
  while (last > first && !loudAt(last)) last--
  const duration = n / rate
  if (first >= wins) return { start: 0, end: duration }   // all silent: nothing to cut
  return { start: Math.max(0, first * win / rate - KEEP_BEFORE), end: Math.min(duration, (last + 1) * win / rate + KEEP_AFTER) }
}
