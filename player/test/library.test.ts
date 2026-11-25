// node --experimental-strip-types test/library.test.ts
import assert from 'node:assert/strict'
import {
  followActivity, groupReleases, isBusy, libraryArtists, playlistSongs, queueFrom, releaseSongs, rulesSummary, songArtist, songTitle, statusLabel, type Song
} from '../src/lib/library.ts'
import { queryFromView, viewFromQuery } from '../src/lib/views.ts'

const rel = (id: number, kind: string, date: string, extra: object = {}) =>
  ({ release_id: id, artist_id: 1, title: `Disco ${id}`, kind, date, cover: null, tracks: 10, status: 'done', reason: 'discografía', ...extra }) as any

// Releases are grouped albums / EP / singles / the rest, newest first; lives go with compilations.
const groups = groupReleases([
  rel(1, 'album', '2010-01-01'), rel(2, 'album', '2020-01-01'), rel(3, 'single', '2021-05-01'),
  rel(4, 'album', '2019-01-01', { status: 'skipped', reason: 'directo' }), rel(5, 'compile', '2018-01-01'), rel(6, 'ep', '2015-01-01')
])
assert.deepEqual(groups.map((g) => g.key), ['album', 'ep', 'single', 'other'])
assert.deepEqual(groups[0].releases.map((r) => r.release_id), [2, 1])
assert.deepEqual(groups[3].releases.map((r) => r.release_id), [4, 5])
assert.deepEqual(groupReleases([]), [])

// Badges.
assert.deepEqual(statusLabel({ status: 'skipped', reason: 'ya está en «Disco»' }), { text: 'No se baja', hint: 'ya está en «Disco»' })
assert.equal(statusLabel({ status: 'wanted', reason: '', attempts: 1, error: 'sin fuentes' }).text, 'Reintentará')
assert.equal(statusLabel({ status: 'failed', reason: '', error: 'sin fuentes' }).hint, 'sin fuentes')
assert.equal(statusLabel({ status: 'done', reason: 'discografía' }).hint, '')

// Songs of a downloaded release: files in order, failed ones left out, durations when the lists match.
const detail = {
  ...rel(9, 'album', '2020-01-01'), artist_name: 'Grupo', title: 'Disco',
  files: [{ title: 'Uno', artist: 'Grupo', status: 'done', path: '/Música/Artistas/Grupo/Disco/01 - Uno.opus' },
          { title: 'Dos', artist: '', status: 'failed', path: null },
          { title: '', artist: '', status: 'done', path: '/Música/Artistas/Grupo/Disco/03 - Tres.opus' }],
  tracklist: [{ title: 'Uno', duration: 200 }, { title: 'Dos', duration: 180 }, { title: 'Tres', duration: 240 }]
}
const songs = releaseSongs(detail)
assert.deepEqual(songs.map((s) => [s.title, s.artist, s.duration]), [['Uno', 'Grupo', 200], ['Tres', 'Grupo', 240]])
assert.equal(songs[0].album, 'Disco')
assert.deepEqual(releaseSongs({ ...rel(10, 'album', ''), files: null }), [])

assert.equal(songTitle('/Música/GYM/Artista - Canción.mp3'), 'Canción')
assert.equal(songTitle('/Música/x/03 - Título - Remix.opus'), 'Título - Remix')
assert.equal(songArtist('/Música/GYM/Artista - Canción.mp3'), 'Artista')
assert.equal(songArtist('/Música/x/03 - Título.opus'), '')

// The queue: in order from the chosen song, or that song first and the rest shuffled.
const pool: Song[] = ['a', 'b', 'c', 'd'].map((k) => ({ key: k, path: k, title: k, artist: '', album: '', cover: null, duration: 0 }))
assert.deepEqual(queueFrom(pool, pool[2], false), { queue: pool, index: 2 })
const shuffledQueue = queueFrom(pool, pool[2], true, () => 0.3)
assert.equal(shuffledQueue.index, 0)
assert.equal(shuffledQueue.queue[0].key, 'c')
assert.deepEqual([...shuffledQueue.queue].map((s) => s.key).sort(), ['a', 'b', 'c', 'd'])
assert.deepEqual(queueFrom([], null, true), { queue: [], index: -1 })

// Sidebar activity and the poll's pace.
const follow = (counts: object, checked: number | null = 1) => ({ artist_id: 1, name: 'A', checked, counts }) as any
assert.equal(followActivity(follow({}, null)), 'Buscando sus discos…')
assert.equal(followActivity(follow({ downloading: 2, wanted: 3, done: 4 })), '5 por bajar')
assert.equal(followActivity(follow({ failed: 1, done: 4 })), '1 con fallos')
assert.equal(followActivity(follow({ done: 4 })), '')
assert.equal(isBusy([follow({ done: 4 })]), false)
assert.equal(isBusy([follow({ done: 4 }), follow({ wanted: 1 })]), true)

assert.equal(rulesSummary({ mode: 'all', since_year: null, types: ['album', 'ep', 'single'] }), 'Álbumes, ep y sencillos: toda la discografía')
assert.equal(rulesSummary({ mode: 'since', since_year: 2015, types: ['album'] }), 'Álbumes desde 2015')

// The page lives in the URL.
for (const view of [{ v: 'home' }, { v: 'search', q: 'reno' }, { v: 'search', q: 'x', tab: 'tracks' }, { v: 'playlist', id: 3 }, { v: 'artist', id: 7 }, { v: 'release', id: 9 }, { v: 'folder', path: '/Música/GYM' }] as const) {
  assert.deepEqual(viewFromQuery(queryFromView(view as any)), view.v === 'search' ? view : view)
}
assert.deepEqual(viewFromQuery({ v: 'artist', id: 'x' }), { v: 'home' })
assert.deepEqual(viewFromQuery({}), { v: 'home' })

// Songs of a downloaded release carry their Deezer song (to add one to a playlist); playlist songs play.
const withIds = releaseSongs({ ...detail, files: [{ ...detail.files[0], track_id: 77, duration: 199 }] })
assert.equal(withIds[0].trackId, 77)
assert.equal(withIds[0].duration, 199)
const fromList = playlistSongs([{ key: 'i:X', path: '/Música/a.opus', title: 'A', artist: 'B', album: 'C', cover: null, duration: 10,
                                  release_id: 5, artist_id: 6, isrc: 'X', item_id: 1 }])
assert.deepEqual(fromList.map((s) => [s.key, s.releaseId]), [['/Música/a.opus', 5]])

// The library's artists: those followed and those with music here without being followed, by name.
const lib = libraryArtists([follow({ downloading: 1 }), { ...follow({}), artist_id: 2, name: 'Zeta' }] as any, [
  { ...rel(1, 'album', '2020'), artist_id: 1, artist_name: 'A' },
  { ...rel(2, 'album', '2020'), artist_id: 3, artist_name: 'Barón Rojo', cover: 'c.jpg' },
  { ...rel(3, 'album', '2021'), artist_id: 3, artist_name: 'Barón Rojo' },
  { ...rel(-4, 'song', '2021'), artist_id: 3, artist_name: 'Barón Rojo' },
  { ...rel(5, 'album', '2022', { status: 'wanted' }), artist_id: 4, artist_name: 'amaral' },
])
assert.deepEqual(lib.map((a) => [a.name, a.followed, a.note]), [
  ['A', true, '1 por bajar'], ['amaral', false, '1 por bajar'], ['Barón Rojo', false, '2 discos · 1 canción'], ['Zeta', true, '']])
assert.equal(lib[2].picture, 'c.jpg')

console.log('library: ok')
