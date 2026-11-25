/**
 * Lyrics without the server: a `.lrc` next to a song of the device, or LRCLIB (lrclib.net, public, the same
 * source the server asks after Deezer). A hand-made shift is kept on this device, per song.
 */
import type { Lyrics } from './api.ts'
import type { Song } from './library.ts'

const OFFSETS = 'reproductor.lyrics.offsets'

/** "[01:02.50]text" lines → synced lines; text without times → plain. Metadata tags ([ar:…], [offset:…]) apply. */
export function parseLrc(text: string): { synced: { t: number; text: string }[] | null; plain: string | null } {
  const synced: { t: number; text: string }[] = []
  const plain: string[] = []
  let shift = 0
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const meta = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i)
    if (meta) { shift = Number(meta[1]) / 1000; continue }
    if (/^\s*\[[a-z]+:.*\]\s*$/i.test(raw)) continue
    const times = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)]
    const words = raw.replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim()
    if (!times.length) { plain.push(raw.trim()); continue }
    for (const m of times) synced.push({ t: Math.max(0, Number(m[1]) * 60 + Number(m[2].replace(':', '.')) - shift), text: words })
  }
  synced.sort((a, b) => a.t - b.t)
  const rest = plain.join('\n').trim()
  return { synced: synced.length ? synced : null, plain: synced.length ? synced.map((l) => l.text).join('\n') : rest || null }
}

function offsets(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(OFFSETS) || '{}') } catch (_) { return {} }
}
export function saveLocalOffset(key: string, offset: number) {
  const all = offsets()
  if (offset) all[key] = offset
  else delete all[key]
  try { localStorage.setItem(OFFSETS, JSON.stringify(all)) } catch (_) {}
}

const none = (key: string): Lyrics => ({ found: false, source: null, instrumental: false, synced: null, plain: null, key, offset: 0 })

/** The lyrics of a song, from a `.lrc` (`lrc`: its text, if the device has one) or from LRCLIB. */
export async function localLyrics(song: Song, lrc?: string | null): Promise<Lyrics> {
  const key = song.key
  const offset = offsets()[key] || 0
  if (lrc && lrc.trim()) {
    const got = parseLrc(lrc)
    return { found: true, source: 'archivo .lrc', instrumental: false, ...got, key, offset }
  }
  const q = new URLSearchParams({ artist_name: song.artist, track_name: song.title })
  if (song.album) q.set('album_name', song.album)
  if (song.duration) q.set('duration', String(Math.round(song.duration)))
  let res = await fetch(`https://lrclib.net/api/get?${q}`)
  if (res.status === 404) {
    // without the album and duration it finds more (another edition of the same song)
    res = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ artist_name: song.artist, track_name: song.title })}`)
    if (!res.ok) return none(key)
    const hits: any[] = await res.json()
    const best = hits.find((h) => h.syncedLyrics) || hits.find((h) => h.plainLyrics || h.instrumental)
    if (!best) return none(key)
    return fromLrclib(best, key, offset)
  }
  if (!res.ok) throw new Error(`LRCLIB respondió ${res.status}`)
  return fromLrclib(await res.json(), key, offset)
}

function fromLrclib(hit: any, key: string, offset: number): Lyrics {
  const synced = hit.syncedLyrics ? parseLrc(hit.syncedLyrics).synced : null
  return { found: !!(synced || hit.plainLyrics || hit.instrumental), source: 'LRCLIB', instrumental: !!hit.instrumental, synced,
           plain: hit.plainLyrics || null, key, offset }
}
