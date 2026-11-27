/**
 * The radio: when the queue is about to end, it goes on with songs like the last ones instead of stopping. Songs one
 * has (the cloud's, this device's, a library's), of the same artists and of those Deezer relates to them; then, if few,
 * what one listens to most and other artists of the library. None played lately or already in the queue, a few of each
 * artist.
 *
 * Deezer is asked by the app's own fetch (the desktop's, the phone's host: Deezer gives no CORS); the web, which has
 * none, goes on with the same artists and what one listens to most.
 */
import type { Api } from './api.ts'
import type { DeviceLibrary } from './device.ts'
import { plainName, type Fetcher } from './deezer.ts'
import { shuffled, type Song } from './library.ts'
import { mine, topSongs } from './mine.ts'
import { songsOf } from './sources.ts'
import type { LibraryEntry } from './store.ts'

export interface RadioSources {
  api?: Api
  device: DeviceLibrary | null
  /** the artists of the library (the cloud's: their view is the server's artist page) */
  artists: () => LibraryEntry[]
  /** a fetch that reaches Deezer (null on the web) */
  fetcher: Fetcher | null
}

/** how many songs it adds each time, and of one artist at most */
const BATCH = 25
const PER_ARTIST = 4
/** artists taken from the queue's end, and related ones asked for each */
const SEEDS = 3
const RELATED = 12
/** songs listened to lately are left out */
const RECENT = 150

interface Who { id?: number | null; name: string }

/** Deezer's artist for a name (its id), when the song does not say it; kept for this run. */
const ids = new Map<string, number | null>()
async function deezerArtist(who: Who, fetcher: Fetcher): Promise<number | null> {
  if (who.id) return who.id
  const k = plainName(who.name)
  if (ids.has(k)) return ids.get(k)!
  let id: number | null = null
  try {
    const res = await fetcher(`https://api.deezer.com/search/artist?q=${encodeURIComponent(who.name)}&limit=3`)
    const hits: any[] = (await res.json())?.data || []
    id = (hits.find((h) => plainName(h.name || '') === k) || hits[0])?.id || null
  } catch (_) {}
  ids.set(k, id)
  return id
}
/** The artists Deezer relates to this one (its names and ids), kept for this run. */
const relatedOf = new Map<number, Who[]>()
async function related(id: number, fetcher: Fetcher): Promise<Who[]> {
  if (relatedOf.has(id)) return relatedOf.get(id)!
  let list: Who[] = []
  try {
    const res = await fetcher(`https://api.deezer.com/artist/${id}/related?limit=${RELATED}`)
    list = ((await res.json())?.data || []).map((a: any) => ({ id: a.id, name: a.name || '' }))
  } catch (_) {}
  relatedOf.set(id, list)
  return list
}

/** The songs one has of an artist: in the cloud (by its Deezer id, or name) and on this device (by name). */
async function songsBy(who: Who, src: RadioSources): Promise<Song[]> {
  const k = plainName(who.name)
  const out: Song[] = []
  const cloud = src.artists().find((e) => (who.id && e.view.v === 'artist' && e.view.id === who.id) || plainName(e.name) === k)
  if (cloud && !cloud.device) out.push(...await songsOf(cloud.view, src.api, src.device).catch(() => []))
  const here = src.device?.artists.find((a) => plainName(a.name) === k)
  if (here) out.push(...src.device!.songs(here.tracks))
  return out
}

/** Songs to go on with after `seeds` (the queue's last songs), none of `exclude`. */
export async function radioSongs(seeds: Song[], exclude: Set<string>, src: RadioSources): Promise<Song[]> {
  const leave = new Set([...exclude, ...mine.history.slice(0, RECENT).map((p) => p.song.key)])
  // the queue's last artists, the latest first
  const seen = new Set<string>()
  const firsts: Who[] = []
  for (const s of [...seeds].reverse()) {
    const name = s.artistName || s.artist.split(/,| & | feat\.? /i)[0].trim()
    if (!name || seen.has(plainName(name))) continue
    seen.add(plainName(name))
    firsts.push({ id: s.artistId || null, name })
    if (firsts.length >= SEEDS) break
  }
  // and those Deezer relates to them (each seed's in turn, so they mix)
  const others: Who[] = []
  if (src.fetcher) {
    const lists = await Promise.all(firsts.map(async (w) => {
      const id = await deezerArtist(w, src.fetcher!)
      return id ? related(id, src.fetcher!) : []
    }))
    for (let i = 0; i < RELATED; i++) {
      for (const l of lists) {
        const w = l[i]
        if (w && !seen.has(plainName(w.name))) { seen.add(plainName(w.name)); others.push(w) }
      }
    }
  }
  // what one has of each, a few of each artist
  const picked: Song[] = []
  const taken = new Set<string>()
  const take = (songs: Song[], max: number) => {
    let n = 0
    for (const s of shuffled(songs)) {
      if (n >= max || picked.length >= BATCH * 2) break
      if (leave.has(s.key) || taken.has(s.key)) continue
      taken.add(s.key)
      picked.push(s)
      n++
    }
  }
  // each artist's songs asked at once (each may be a request to the server)
  const all = async (who: Who[]) => Promise.all(who.map((w) => songsBy(w, src).catch(() => [] as Song[])))
  for (const songs of await all(firsts)) take(songs, PER_ARTIST)
  for (const songs of await all(others)) take(songs, PER_ARTIST)
  // few (one has little like them): what one listens to most, then artists of one's library at random
  if (picked.length < BATCH) take(topSongs(200).map((t) => t.song), BATCH - picked.length)
  if (picked.length < BATCH) {
    const more = shuffled(src.artists()).filter((e) => !seen.has(plainName(e.name))).slice(0, 12)
    for (const songs of await all(more.map((e) => ({ id: e.view.v === 'artist' ? e.view.id : null, name: e.name })))) {
      if (picked.length >= BATCH) break
      take(songs, 2)
    }
  }
  if (picked.length < BATCH && src.device) take(src.device.songs(shuffled(src.device.state.tracks).slice(0, 200)), BATCH - picked.length)
  // the like ones first (the latest artist's, the related), then the rest; each part shuffled
  return picked.slice(0, BATCH)
}
