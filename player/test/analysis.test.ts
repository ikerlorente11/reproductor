// node --experimental-strip-types test/analysis.test.ts
import assert from 'node:assert/strict'
import { edges, loudness } from '../src/lib/analysis.ts'

const RATE = 16000
const tone = (seconds: number, amplitude: number, hz = 997) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / RATE))
const near = (got: number | null, want: number, by = 0.5) => assert.ok(got !== null && Math.abs(got - want) <= by, `${got} ≠ ${want} ±${by}`)

// BS.1770's reference: a 997 Hz sine peaking at -20 dBFS in one channel reads -23.0 LUFS; in both, 3 dB more (measured
// at 16 kHz the filters drift a little: within half a decibel, not heard when evening out songs)
const minus20 = Math.pow(10, -20 / 20)
near(loudness([tone(10, minus20)], RATE), -23)
near(loudness([tone(10, minus20), tone(10, minus20)], RATE), -20)
// 10 dB quieter, 10 LU less
near(loudness([tone(10, minus20 / Math.pow(10, 0.5))], RATE), -33)
// the silence in the middle does not lower it (the blocks below -70 LUFS are left out)
const gap = new Float32Array(RATE * 10)
const withGap = Float32Array.from([...tone(5, minus20), ...gap, ...tone(5, minus20)])
near(loudness([withGap], RATE), -23)
// silence, or too short: no loudness
assert.equal(loudness([new Float32Array(RATE * 5)], RATE), null)
assert.equal(loudness([tone(0.2, 0.5)], RATE), null)

// The edges: 2 s of silence, 6 s of sound, 3 s of silence → the sound from 2 s to 8 s (a little kept around)
const song = Float32Array.from([...new Float32Array(RATE * 2), ...tone(6, 0.3), ...new Float32Array(RATE * 3)])
const e = edges([song], RATE)
assert.ok(e.start > 1.9 && e.start <= 2, `start ${e.start}`)
assert.ok(e.end >= 8 && e.end < 8.3, `end ${e.end}`)
// no silence: nothing cut; all silence: nothing cut either
const full = edges([tone(3, 0.3)], RATE)
assert.equal(full.start, 0)
assert.ok(full.end >= 2.99, `end ${full.end}`)
assert.deepEqual(edges([new Float32Array(RATE)], RATE), { start: 0, end: 1 })
// very quiet sound (-60 dBFS) counts as silence
const hiss = Float32Array.from([...tone(1, 0.001), ...tone(2, 0.3), ...tone(1, 0.001)])
const h = edges([hiss], RATE)
assert.ok(h.start > 0.9 && h.end < 3.3, `hiss ${h.start}-${h.end}`)

console.log('analysis: ok')
