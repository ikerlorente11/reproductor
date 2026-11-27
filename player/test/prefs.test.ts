// node --experimental-strip-types test/prefs.test.ts
// The settings shared through the server (prefs.ts), against a server that behaves as the real one (the latest wins).
import assert from 'node:assert/strict'
import { eq } from '../src/lib/eq.ts'
import { player, radio, sound } from '../src/lib/player.ts'
import { startPrefs, stopPrefs } from '../src/lib/prefs.ts'
import { quality } from '../src/lib/quality.ts'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** a server as El Archivador's: older settings arriving late are refused, and the newer ones answered */
const server = {
  prefs: {} as Record<string, any>,
  updated: 0,
  puts: 0,
  async prefs_() { return { prefs: this.prefs, updated: this.updated } },
  async putPrefs(prefs: object, updated: number) {
    this.puts++
    if (this.updated > updated) return { kept: false, prefs: this.prefs, updated: this.updated }
    this.prefs = JSON.parse(JSON.stringify(prefs))
    this.updated = updated
    return { kept: true, prefs: this.prefs, updated }
  }
}
const api = { prefs: () => server.prefs_(), putPrefs: (p: object, u: number) => server.putPrefs(p, u) } as any

// 1. another device set them (newer than this one's, which never changed): they are taken
server.prefs = { sound: { normalize: false, trim: true }, eq: { on: true, preset: 'rock', custom: Array(10).fill(0) }, radio: true,
                 quality: { wifi: 'low' }, rate: 1.25 }
server.updated = Date.now() / 1000 - 60
startPrefs(api)
await wait(50)
assert.equal(sound.normalize, false)
assert.equal(eq.all.on, true)
assert.equal(eq.all.preset, 'rock')
assert.equal(radio.on, true)
assert.equal(quality.wifi, 'low')
assert.equal(player.rate, 1.25)
assert.equal(server.puts, 0, 'taking them sends nothing back')

// 2. changed here: sent a moment later, as the latest
eq.all.preset = 'pop'
await wait(1700)
assert.equal(server.puts, 1)
assert.equal(server.prefs.eq.preset, 'pop')
assert.ok(server.updated > Date.now() / 1000 - 5)

// 3. what is not shared does not travel: the extra volume, the mobile quality, each output's equaliser
sound.boost = 6
quality.mobile = 'low'
await wait(1700)
assert.equal(server.puts, 1)
assert.equal(server.prefs.sound.boost, undefined)

// 4. changed here while another device changed them later: the server keeps the newer ones, and this one takes them
server.prefs = { ...server.prefs, radio: false }
server.updated = Date.now() / 1000 + 100   // (later than this device's change below)
sound.trim = false
await wait(1700)
assert.equal(radio.on, false, 'the newer ones came back and were taken')
stopPrefs()

console.log('prefs: ok')
