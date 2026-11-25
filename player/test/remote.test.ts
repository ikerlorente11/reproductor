// node --experimental-strip-types test/remote.test.ts
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { DeviceBackend, DeviceTrack } from '../src/lib/device.ts'
import { RemoteLibraries, withRemotes } from '../src/lib/libraries.ts'
import { JellyfinSource, SubsonicSource, splitRemote } from '../src/lib/remote.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const ok = (extra: object) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...extra } })

// ---- Subsonic: signed requests (no password sent), every song a page at a time, its errors in words ----
const songs = Array.from({ length: 501 }, (_, i) => ({ id: `s${i}`, title: `T${i}`, album: 'Disco', artist: 'Grupo', track: i + 1, year: 2001,
  duration: 200, coverArt: 'al-1', suffix: 'flac', path: `Grupo/Disco/${i}.flac`, created: '2026-01-02T00:00:00Z' }))
const asked: URL[] = []
const subsonic: typeof fetch = async (input) => {
  const url = new URL(String(input))
  asked.push(url)
  const p = url.searchParams
  if (p.get('t') !== createHash('md5').update('secreta' + p.get('s')).digest('hex') || p.has('p')) {
    return json({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } })
  }
  if (url.pathname === '/rest/ping') return json(ok({}))
  if (url.pathname === '/rest/search3') {
    const from = Number(p.get('songOffset')), n = Number(p.get('songCount'))
    return json(ok({ searchResult3: { song: songs.slice(from, from + n) } }))
  }
  return json({}, 404)
}
const cfg = { id: 'nd', kind: 'subsonic' as const, name: 'Casa', url: 'https://musica.example/', username: 'iker' }
const sub = new SubsonicSource(cfg, 'secreta', subsonic)
await sub.check()
const got = await sub.songs()
assert.equal(got.length, 501)
assert.deepEqual(asked.filter((u) => u.pathname === '/rest/search3').map((u) => u.searchParams.get('songOffset')), ['0', '500'])
assert.deepEqual({ id: got[0].id, path: got[0].path, album: got[0].album, year: got[0].year, cover: got[0].cover },
  { id: 'r:nd:s0', path: 'Casa/Grupo/Disco/0.flac', album: 'Disco', year: 2001, cover: 'r:nd:al-1' })
assert.match(sub.streamUrl('s0'), /^https:\/\/musica\.example\/rest\/stream\?u=iker&t=[0-9a-f]{32}&s=/)
await assert.rejects(new SubsonicSource(cfg, 'mala', subsonic).check(), /usuario o la contraseña/)

// ---- Jellyfin: logs in once, reads the audio items, plays with its token ----
let logins = 0
const jellyfin: typeof fetch = async (input, init) => {
  const url = new URL(String(input))
  if (url.pathname === '/Users/AuthenticateByName') {
    logins++
    const body = JSON.parse(String(init?.body))
    return body.Pw === 'secreta' ? json({ AccessToken: 'tok', User: { Id: 'u1' } }) : json({}, 401)
  }
  if (url.pathname === '/Users/u1/Items') {
    assert.match(String((init?.headers as any).Authorization), /Token="tok"/)
    return json({ Items: [{ Id: 'a1', Name: 'Una', Album: 'Disco', AlbumArtist: 'Grupo', Artists: ['Grupo', 'Otro'], IndexNumber: 3,
      ParentIndexNumber: 1, ProductionYear: 1999, RunTimeTicks: 2000000000, AlbumId: 'al', AlbumPrimaryImageTag: 'x', Path: '/m/Grupo/Disco/03 Una.mp3' }] })
  }
  return json({}, 404)
}
const jf = new JellyfinSource({ id: 'jf', kind: 'jellyfin', name: 'Jelly', url: 'http://jf.local:8096', username: 'iker' }, 'secreta', jellyfin)
const jsongs = await jf.songs()
assert.equal(logins, 1)
assert.deepEqual({ id: jsongs[0].id, artist: jsongs[0].artist, duration: jsongs[0].duration, track: jsongs[0].track, path: jsongs[0].path, cover: jsongs[0].cover },
  { id: 'r:jf:a1', artist: 'Grupo, Otro', duration: 200, track: 3, path: 'Jelly/Grupo/Disco/03 Una.mp3', cover: 'r:jf:al' })
assert.match(jf.streamUrl('a1'), /\/Audio\/a1\/universal\?.*api_key=tok/)
await assert.rejects(new JellyfinSource({ id: 'x', kind: 'jellyfin', name: 'J', url: 'http://jf.local:8096', username: 'iker' }, 'mala', jellyfin).check(), /contraseña/)

// ---- joined to the device's music: one more folder; its songs play from the server ----
const store = new Map<string, string>()
const secrets = { get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v) }, delete: async (k: string) => { store.delete(k) } }
const libs = new RemoteLibraries(secrets, subsonic)
const local: DeviceBackend = {
  get: async () => ({ roots: ['C:\\Música'], tracks: [{ id: 'abc', path: 'C:\\Música\\a.mp3' } as DeviceTrack], scanning: false }),
  scan: async () => {}, addRoot: async () => false, removeRoot: async () => {},
  fileUrl: (id) => `local/${id}`, coverUrl: (c) => `cover/${c}`, onProgress: () => () => {}, onChanged: () => () => {}
}
const joined = withRemotes(local, libs)
let changes = 0
joined.onChanged(() => { changes++ })
const added = await libs.add({ kind: 'subsonic', name: 'Casa', url: 'https://musica.example', username: 'iker' }, 'secreta')
assert.equal(store.get(`library:${added.id}`), 'secreta')
await assert.rejects(libs.add({ kind: 'subsonic', name: 'casa', url: 'https://otra.example', username: 'x' }, 'secreta'), /ya hay una biblioteca/)
for (let i = 0; i < 50 && !libs.state.counts[added.id]; i++) await new Promise((r) => setTimeout(r, 10))
const all = await joined.get()
assert.deepEqual(all.roots, ['C:\\Música', 'Casa'])
assert.equal(all.tracks.length, 502)
assert.ok(changes > 0)
const remote = all.tracks.find((t) => t.id.startsWith('r:'))!
assert.deepEqual(splitRemote(remote.id), [added.id, 's0'])
assert.match(joined.fileUrl(remote.id), /\/rest\/stream\?/)
assert.equal(joined.fileUrl('abc'), 'local/abc')
assert.match(joined.coverUrl(remote.cover!), /\/rest\/getCoverArt\?/)
await joined.removeRoot('Casa')
assert.deepEqual((await joined.get()).roots, ['C:\\Música'])
assert.equal(store.has(`library:${added.id}`), false)

console.log('remote: ok')
