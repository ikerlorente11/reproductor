/**
 * Which releases of an artist to download, and what one already has of a song: the service's discography.py and
 * holdings.py, the same rules, for an app without a server (pocket.ts). Pure logic.
 *
 * An artist's catalogue on Deezer repeats itself: singles that later come out inside an album, the same single
 * published twice, deluxe re-releases, live albums, compilations. Rules, in order:
 *   1. compilations and live releases are left out unless asked for (`types`);
 *   2. releases are walked albums first, then EPs, then singles, each group oldest first;
 *   3. a release is wanted only if it brings at least one recording not already covered by the ones before it
 *      (recordings are compared by ISRC, or by title and length when Deezer gives none);
 *   4. the rules' mode then limits by date: everything, since a year, or only what comes out after following.
 */
import type { Kind, Mode } from './api.ts'

export const DEFAULT_TYPES: Kind[] = ['album', 'ep', 'single']
export interface DiscTrack { id: number; title: string; isrc: string | null; duration: number }
export interface Disc { id: number; title: string; kind: string; date: string; tracks: DiscTrack[]; cover: string | null }
export interface Decision { release: number; wanted: boolean; reason: string }

const ORDER: Record<string, number> = { album: 0, ep: 1, single: 2, compile: 3 }
const LIVE = /\b(live|en directo|directo|en vivo|unplugged)\b/i
/** Without accents nor any other letter outside ASCII (as Python's encode("ascii", "ignore")). */
const ascii = (s: string) => s.normalize('NFKD').replace(/[^\x00-\x7f]/g, '')

export function norm(text: string): string {
  return ascii(text).toLowerCase().replace(/\(.*?\)|\[.*?\]|-\s*single$/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Words that make a take another recording though its title is the same once brackets go. */
const VERSIONS: Record<string, string> = {
  instrumental: 'instrumental', karaoke: 'karaoke', acapella: 'acapella', 'a capella': 'acapella', 'a cappella': 'acapella',
  acappella: 'acapella', remix: 'remix', live: 'live', directo: 'live', 'en vivo': 'live', acoustic: 'acoustic', acustica: 'acoustic',
  acustico: 'acoustic', 'sped up': 'spedup', slowed: 'slowed', demo: 'demo'
}

/** The kind of take a title says it is in its brackets or after « - » («instrumental», «live»…), or "". */
export function versionOf(title: string): string {
  const plain = ascii(title).toLowerCase()
  const parts: string[] = []
  for (const m of plain.matchAll(/\((.*?)\)|\[(.*?)\]|\s-\s(.*)$/g)) parts.push(m[1] || '', m[2] || '', m[3] || '')
  const words = ' ' + parts.join(' ').replace(/[^a-z0-9]+/g, ' ') + ' '
  return [...new Set(Object.entries(VERSIONS).filter(([w]) => words.includes(` ${w} `)).map(([, tag]) => tag))].sort().join('+')
}

/** What identifies a recording: its ISRC, and its title with its length to the nearest few seconds. */
export function recordingKeys(t: Pick<DiscTrack, 'title' | 'isrc' | 'duration'>): string[] {
  const keys: string[] = []
  if (t.title) {
    const version = versionOf(t.title)
    keys.push(`t:${version ? `${norm(t.title)}#${version}` : norm(t.title)}:${Math.round((t.duration || 0) / 4)}`)
  }
  if (t.isrc) keys.push(`i:${t.isrc.toUpperCase()}`)
  return keys
}

export function decide(releases: Disc[], types: string[] = DEFAULT_TYPES, mode: Mode = 'all',
                       sinceYear: number | null = null, followedOn: string | null = null): Decision[] {
  const wantedTypes = new Set(types)
  const out: Decision[] = []
  const covered = new Set<string>()
  const coveredBy = new Map<string, string>()
  const sorted = [...releases].sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9) || a.date.localeCompare(b.date) || a.id - b.id)
  for (const r of sorted) {
    if (LIVE.test(r.title) && !wantedTypes.has('live')) { out.push({ release: r.id, wanted: false, reason: 'directo' }); continue }
    if (!wantedTypes.has(r.kind)) {
      out.push({ release: r.id, wanted: false, reason: ({ compile: 'recopilatorio', single: 'sencillo', ep: 'EP' } as Record<string, string>)[r.kind] || r.kind })
      continue
    }
    const keys = r.tracks.map(recordingKeys)
    const fresh = keys.filter((k) => !k.some((key) => covered.has(key)))
    if (r.tracks.length && !fresh.length) {
      const first = keys[0].find((key) => covered.has(key))!
      out.push({ release: r.id, wanted: false, reason: `ya está en «${coveredBy.get(first)}»` })
      continue
    }
    for (const k of keys) for (const key of k) { if (!coveredBy.has(key)) coveredBy.set(key, r.title); covered.add(key) }
    if (mode === 'since' && sinceYear && Number(r.date.slice(0, 4) || 0) < sinceYear) out.push({ release: r.id, wanted: false, reason: `anterior a ${sinceYear}` })
    else if (mode === 'new' && followedOn && r.date < followedOn) out.push({ release: r.id, wanted: false, reason: 'anterior a seguirlo' })
    else out.push({ release: r.id, wanted: true, reason: mode === 'new' ? 'nuevo' : 'discografía' })
  }
  return out
}

/** Lower case, no accents nor punctuation; what is in brackets stays (a live take is another song). */
const plain = (s: string) => ascii(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The same artist give or take a «feat.», «& Scila» or punctuation (unknown on either side: yes). */
export function sameArtist(a: string, b: string): boolean {
  const x = plain(a || '')
  const y = plain(b || '')
  if (!x || !y) return true
  return x === y || ` ${y} `.includes(` ${x} `) || ` ${x} `.includes(` ${y} `)
}
