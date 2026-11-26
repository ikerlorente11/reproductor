// node --experimental-strip-types test/deezer.test.ts
import assert from 'node:assert/strict'
import { bestMatch, plainName, trackInfo } from '../src/lib/deezer.ts'

// «Todos somos Gaza»: Deezer gives Rozalén as its artist; its contributors are everyone, main ones first
const info = trackInfo({
  id: 3617300102, title: 'Todos somos Gaza', duration: 301, bpm: 0, release_date: '2025-10-30', explicit_lyrics: false,
  artist: { id: 1, name: 'Rozalén' },
  contributors: [{ id: 1, name: 'Rozalén', role: 'Main' }, { id: 5, name: 'El Chojin', role: 'Featured' }, { id: 2, name: 'Porta', role: 'Main' },
                 { id: 2, name: 'Porta', role: 'Main' }],
  album: { id: 9, title: 'Todos somos Gaza', cover_medium: 'c.jpg' }
}, { record_type: 'single', release_date: '2025-10-30', nb_tracks: 1, label: 'Sello', genres: { data: [{ name: 'Rap' }] }, artist: { name: 'Rozalén' } })
assert.deepEqual(info.artists.map((a) => [a.name, a.role]), [['Rozalén', 'main'], ['Porta', 'main'], ['El Chojin', 'featured']])
assert.equal(info.bpm, null)
assert.equal(info.album?.label, 'Sello')
assert.deepEqual(info.album?.genres, ['Rap'])
// without contributors: its own artist
assert.deepEqual(trackInfo({ id: 1, title: 'X', artist: { id: 3, name: 'Nach' } }).artists.map((a) => a.name), ['Nach'])

assert.equal(plainName('Have a Drink on Me (Remastered)'), 'have a drink on me')
assert.equal(plainName('Rozalén'), 'rozalen')

// a song of the phone, found among the hits: same title, its artist or its length
const hits = [
  { id: 1, title: 'Have a Drink on Me (Live)', duration: 300, artist: { name: 'AC/DC' } },
  { id: 2, title: 'Have a Drink on Me', duration: 239, artist: { name: 'AC/DC' } },
  { id: 3, title: 'Have a Drink on Me', duration: 180, artist: { name: 'Otro grupo' } }
]
assert.equal(bestMatch(hits, { title: 'Have a Drink on Me', artist: 'AC/DC', duration: 238 })?.id, 2)
// the first of several artists in the tags is enough
assert.equal(bestMatch([{ id: 7, title: 'Todos somos Gaza', duration: 301, artist: { name: 'Rozalén' } }],
                       { title: 'Todos somos Gaza', artist: 'Rozalén, Porta', duration: 300 })?.id, 7)
// another song of the same name by someone else, of another length: not it
assert.equal(bestMatch([hits[2]], { title: 'Have a Drink on Me', artist: 'AC/DC', duration: 238 }), null)

console.log('deezer: ok')
