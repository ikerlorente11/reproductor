/**
 * A song's whole information from Deezer, asked by the app itself (no server needed): every artist on it (who
 * features too), its album with its label and genres, its date, BPM… A song of the cloud is asked by its Deezer id;
 * any other (this device's, a library's) is searched by its artist and title, with a length that fits. Deezer's API is
 * public and asks for no account; only the song's title and artist go to it. The app asks through its own fetch (the
 * host's, the desktop's): Deezer does not let a web page ask it (no CORS), so the web asks the server instead.
 * What was found (or not) is kept on this device, so a song is asked once.
 */
import type { SongArtist, SongInfo } from './api.ts'
import type { Song } from './library.ts'

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

const API = 'https://api.deezer.com'
const CACHE = 'reproductor.songinfo'
const DAY = 86400000
const KEEP_FOUND = 30 * DAY
const KEEP_MISSING = 7 * DAY
const CACHE_MAX = 400

const ROLES: Record<string, SongArtist['role']> = { Main: 'main', Featured: 'featured' }

/** Deezer's song (and its album, when asked) as the player shows it: the same as the server's /api/songs/<id>/info. */
export function trackInfo(data: any, album: any = null): SongInfo {
  const people: any[] = data.contributors?.length ? data.contributors : data.artist ? [data.artist] : []
  const seen = new Set<number>()
  const artists: SongArtist[] = [...people].sort((a, b) => Number(a.role !== 'Main') - Number(b.role !== 'Main'))
    .filter((p) => p?.id && !seen.has(p.id) && !!seen.add(p.id))
    .map((p) => ({ id: p.id, name: p.name || '', role: ROLES[p.role || 'Main'] || 'featured', picture: p.picture_medium || null }))
  const own = data.album || {}
  const whole = album || {}
  return {
    id: data.id, title: data.title || '', version: data.title_version || '', duration: data.duration || 0, isrc: data.isrc || null,
    date: data.release_date || whole.release_date || '', bpm: data.bpm ? Math.round(data.bpm) : null, explicit: !!data.explicit_lyrics,
    track_position: data.track_position ?? null, disk_number: data.disk_number ?? null,
    link: data.link || `https://www.deezer.com/track/${data.id}`,
    artists,
    album: own.id ? {
      id: own.id, title: own.title || whole.title || '', cover: own.cover_medium || null, kind: whole.record_type || '',
      date: whole.release_date || '', tracks: whole.nb_tracks ?? null, label: whole.label || '',
      genres: (whole.genres?.data || []).map((g: any) => g?.name).filter(Boolean), artist_name: whole.artist?.name || ''
    } : null
  }
}

/** For comparing names: no accents, case, punctuation, nor what goes in brackets («(feat. X)», «[Remastered]»). */
export const plainName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()

/** The first artist of a song's tags («Porta, Rozalén» → Porta). */
const firstArtist = (artist: string) => artist.split(/\s*(?:,|;|&|\bfeat\.?|\bft\.?)\s*|\s+\/\s+/i)[0] || artist

/** Of Deezer's hits, the song this is: the same title, by its artist or as long (±4 s); null if none fits well enough. */
export function bestMatch(hits: any[], song: Pick<Song, 'title' | 'artist' | 'duration'>): any | null {
  const title = plainName(song.title)
  const artist = plainName(firstArtist(song.artist))
  let best: any = null
  let bestScore = 0
  for (const h of hits) {
    const t = plainName(h.title || '')
    const named = t === title ? 3 : t && title && (t.includes(title) || title.includes(t)) ? 1 : 0
    if (!named) continue
    const a = plainName(h.artist?.name || '')
    const by = artist && a && (a === artist ? 2 : a.includes(artist) || artist.includes(a) ? 1 : 0)
    const diff = song.duration && h.duration ? Math.abs(song.duration - h.duration) : null
    const long = diff === null ? 0 : diff <= 4 ? 2 : diff <= 10 ? 1 : -2
    const score = named + (by || 0) + long
    if ((by || long > 0) && score > bestScore) { best = h; bestScore = score }
  }
  return best
}

// ---- what was found, kept ----
interface Kept { at: number; info: SongInfo | null }
function kept(): Record<string, Kept> { try { return JSON.parse(localStorage.getItem(CACHE) || '{}') } catch (_) { return {} } }
function keep(key: string, info: SongInfo | null) {
  const all = kept()
  all[key] = { at: Date.now(), info }
  const keys = Object.keys(all)
  if (keys.length > CACHE_MAX) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - CACHE_MAX).forEach((k) => delete all[k])
  try { localStorage.setItem(CACHE, JSON.stringify(all)) } catch (_) {}
}
const keyOf = (song: Song) => (song.trackId ? `dz:${song.trackId}` : `q:${plainName(firstArtist(song.artist))}|${plainName(song.title)}`)

async function ask(fetcher: Fetcher, path: string): Promise<any> {
  const res = await fetcher(API + path)
  if (!res.ok) throw new Error(`Deezer contestó ${res.status}`)
  const body = await res.json()
  if (body?.error) {
    if (body.error.code === 800) return null          // «no data»: it does not have it
    throw new Error(body.error.message || 'Deezer no contesta')
  }
  return body
}

/** Everything of a song (see above); null when Deezer does not have it. Throws when Deezer cannot be reached. */
export async function deezerSongInfo(song: Song, fetcher: Fetcher): Promise<SongInfo | null> {
  const key = keyOf(song)
  const hit = kept()[key]
  if (hit && Date.now() - hit.at < (hit.info ? KEEP_FOUND : KEEP_MISSING)) return hit.info
  let id = song.trackId || 0
  if (!id) {
    const artist = firstArtist(song.artist).trim()
    const title = song.title.replace(/\s*[([].*?[)\]]\s*/g, ' ').trim()
    if (!title) return null
    const strict = artist ? await ask(fetcher, `/search?q=${encodeURIComponent(`artist:"${artist}" track:"${title}"`)}&limit=10`) : null
    let found = bestMatch(strict?.data || [], song)
    if (!found) {
      const loose = await ask(fetcher, `/search?q=${encodeURIComponent(`${artist} ${title}`.trim())}&limit=15`)
      found = bestMatch(loose?.data || [], song)
    }
    id = found?.id || 0
  }
  if (!id) { keep(key, null); return null }
  const data = await ask(fetcher, `/track/${id}`)
  if (!data) { keep(key, null); return null }
  const album = data.album?.id ? await ask(fetcher, `/album/${data.album.id}`).catch(() => null) : null
  const info = trackInfo(data, album)
  keep(key, info)
  return info
}
