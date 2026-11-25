// node --experimental-strip-types test/device.test.ts
import assert from 'node:assert/strict'
import { albumKeyOf, deviceAlbums, deviceArtists, deviceFolder, searchTracks, splitArtists, type DeviceTrack } from '../src/lib/device.ts'
import { parseLrc } from '../src/lib/lyrics.ts'

let n = 0
const t = (path: string, extra: Partial<DeviceTrack> = {}): DeviceTrack => ({
  id: String(++n), path, size: 1, mtime: 1, title: path.split('\\').pop()!, artist: '', album_artist: '', album: '', track: 0, disc: 0,
  year: 0, genre: '', duration: 180, cover: null, added: n, ...extra
})

const tracks = [
  t('C:\\M\\AC-DC\\Highway\\02.mp3', { title: 'Girls', artist: 'AC/DC', album: 'Highway to Hell', track: 2, year: 1979, cover: 'c1' }),
  t('C:\\M\\AC-DC\\Highway\\01.mp3', { title: 'Highway', artist: 'AC/DC', album: 'Highway to Hell', track: 1, year: 1979 }),
  t('C:\\M\\AC-DC\\Back\\01.mp3', { title: 'Hells Bells', artist: 'AC/DC', album: 'Back in Black', track: 1, year: 1980 }),
  t('C:\\M\\Mix\\a.mp3', { title: 'Uno', artist: 'Ska-P', album: 'Éxitos', track: 1 }),
  t('C:\\M\\Mix\\b.mp3', { title: 'Dos', artist: 'Marea feat. Rosendo', album: 'Éxitos', track: 2 }),
  t('C:\\M\\Sueltas\\Pereza - Amelie.mp3', { title: 'Amelie', artist: 'Pereza' }),
  // the same album in another folder (a bonus track copied apart): still the same album
  t('C:\\M\\Extra\\03.mp3', { title: 'Get It Hot', artist: 'AC/DC', album: 'Highway to Hell', track: 3, year: 1979 })
]

// Albums: songs in order, a compilation by «Varios artistas», by artist then year.
const albums = deviceAlbums(tracks)
const highway = albums.find((a) => a.title === 'Highway to Hell')!
assert.deepEqual(highway.tracks.map((x) => x.title), ['Highway', 'Girls', 'Get It Hot'])
assert.equal(highway.cover, 'c1')
assert.equal(albums.find((a) => a.title === 'Éxitos')!.artist, 'Varios artistas')
assert.deepEqual(albums.filter((a) => a.artist === 'AC/DC').map((a) => a.title), ['Highway to Hell', 'Back in Black'])
// a song without album tag is grouped by its folder
assert.equal(albumKeyOf({ album_artist: '', artist: 'X', album: '', path: 'C:\\M\\Sueltas\\x.mp3' }), '\u0002c:\\m\\sueltas')

// Artists: by album artist, guests of compilations count, newest album first.
const artists = deviceArtists(tracks, albums)
const acdc = artists.find((a) => a.name === 'AC/DC')!
assert.deepEqual(acdc.albums.map((a) => a.title), ['Back in Black', 'Highway to Hell'])
assert.equal(acdc.tracks.length, 4)
assert.ok(artists.some((a) => a.name === 'Rosendo'), 'a guest on a compilation is an artist too')
assert.deepEqual(splitArtists('A, B feat. C; D'), ['A', 'B', 'C', 'D'])
assert.deepEqual(splitArtists('AC/DC'), ['AC/DC'])
assert.deepEqual(splitArtists('Simon & Garfunkel'), ['Simon & Garfunkel'])

// A folder: its folders (with how many songs below) and its own songs.
const root = deviceFolder(tracks, 'C:\\M')
assert.deepEqual(root.folders.map((f) => [f.name, f.count]), [['AC-DC', 3], ['Extra', 1], ['Mix', 2], ['Sueltas', 1]])
assert.equal(deviceFolder(tracks, 'C:\\M\\AC-DC\\Highway').tracks[0].title, 'Highway')

// Search: every word, accents aside, title matches first.
assert.deepEqual(searchTracks(tracks, 'exitos').map((x) => x.title), ['Uno', 'Dos'])
assert.deepEqual(searchTracks(tracks, 'acdc hells').map((x) => x.title), [])
assert.deepEqual(searchTracks(tracks, 'ac/dc hells').map((x) => x.title), ['Hells Bells'])

// LRC: times (also several per line), metadata out, [offset] applied.
const lrc = parseLrc('[ar:Someone]\n[offset:+500]\n[00:01.00]Uno\n[00:03.50][00:10.00]Dos\n[00:05.00]\n')
assert.deepEqual(lrc.synced, [{ t: 0.5, text: 'Uno' }, { t: 3, text: 'Dos' }, { t: 4.5, text: '' }, { t: 9.5, text: 'Dos' }])
assert.deepEqual(parseLrc('solo texto\nsin tiempos'), { synced: null, plain: 'solo texto\nsin tiempos' })

console.log('device: ok')
