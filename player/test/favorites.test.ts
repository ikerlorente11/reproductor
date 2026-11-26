// node --experimental-strip-types test/favorites.test.ts
import assert from 'node:assert/strict'
import { countFavorite, FAVORITE_HALF_LIFE, favoriteOf, scoreAt, topFavorites, type Favorite, type PlaySource } from '../src/lib/mine.ts'
import type { Song } from '../src/lib/library.ts'

const song = (n: number, extra: Partial<Song> = {}): Song =>
  ({ key: `/Música/${n}.mp3`, path: `/Música/${n}.mp3`, title: `Canción ${n}`, artist: 'Nach', album: 'Disco', cover: `c${n % 6}`, duration: 200, ...extra })
const gym: PlaySource = { kind: 'list', key: 'playlist:7', name: 'GYM', view: { v: 'playlist', id: 7 } }
const DAY = 86400000

// A song played from a list counts for the list; any other, for its artist (by id, by name on the device, else searched).
assert.equal(favoriteOf(song(1), gym)?.key, 'playlist:7')
assert.deepEqual(favoriteOf(song(1, { artistId: 12 }), null), { key: 'artist:12', kind: 'artist', name: 'Nach', view: { v: 'artist', id: 12 } })
assert.deepEqual(favoriteOf(song(1, { device: 'x', artistName: 'Nach' }), null)?.view, { v: 'lartist', name: 'Nach' })
assert.deepEqual(favoriteOf(song(1), null)?.view, { v: 'search', q: 'Nach' })
assert.equal(favoriteOf(song(1, { artist: '' }), null), null)

// A play weighs half after the half life.
assert.equal(scoreAt({ score: 8, at: 0 }, FAVORITE_HALF_LIFE), 4)

// What is listened to every day comes before what was listened to a lot long ago.
const all: Record<string, Favorite> = {}
const now = 100 * DAY
for (let i = 0; i < 60; i++) countFavorite(all, song(i, { artistId: 3, artist: 'Sabaton' }), null, now - 30 * DAY + i * 1000)
for (let d = 7; d >= 1; d--) for (let i = 0; i < 6; i++) countFavorite(all, song(i), gym, now - d * DAY + i * 1000)
const top = topFavorites(all, now)
assert.equal(top[0].key, 'playlist:7')
assert.equal(top[0].plays, 42)
assert.equal(top[1].key, 'artist:3')
// a list keeps up to 4 covers of its songs, for its mosaic
assert.deepEqual(all['playlist:7'].covers, ['c0', 'c1', 'c2', 'c3'])
// what weighs too little no longer shows
assert.deepEqual(topFavorites(all, now + 400 * DAY), [])

console.log('favorites: ok')
