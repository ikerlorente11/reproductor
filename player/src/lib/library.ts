/** Pure helpers of El Reproductor (no Vue, no network): labels, grouping, songs and the queue. */
import type { Follow, Kind, Mode, PlaylistSong, Release, ReleaseDetail, Rules, Status, TrackHit } from './api.ts'

export const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: 'all', label: 'Toda la discografía', hint: 'Todo lo que ha sacado y lo que saque' },
  { value: 'since', label: 'Desde un año', hint: 'Lo que sacó a partir de ese año y lo que saque' },
  { value: 'new', label: 'Solo lo nuevo', hint: 'Nada de lo anterior: solo lo que saque a partir de hoy' }
]
export const TYPES: { value: Kind; label: string }[] = [
  { value: 'album', label: 'Álbumes' },
  { value: 'ep', label: 'EP' },
  { value: 'single', label: 'Sencillos' },
  { value: 'compile', label: 'Recopilatorios' },
  { value: 'live', label: 'Directos' }
]
export const DEFAULT_RULES: Rules = { mode: 'all', since_year: null, types: ['album', 'ep', 'single'] }

const STATUS_LABEL: Record<Status, string> = {
  done: 'Descargado',
  downloading: 'Descargando…',
  wanted: 'Pendiente',
  skipped: 'No se baja',
  failed: 'Falló',
  'preview-wanted': 'Se bajará',
  'preview-skipped': 'No se bajaría',
  'preview-pending': 'Calculando…'
}

/** The badge of a release, e.g. "No se baja · ya está en «Disco»". */
export function statusLabel(r: Pick<Release, 'status' | 'reason' | 'attempts' | 'error'>): { text: string; hint: string } {
  const text = STATUS_LABEL[r.status] || r.status
  if (r.status === 'wanted' && r.attempts) return { text: 'Reintentará', hint: r.error ? `Falló: ${r.error}` : '' }
  if (r.status === 'failed') return { text, hint: r.error || '' }
  if (r.status === 'skipped' || r.status === 'preview-skipped') return { text, hint: r.reason || '' }
  return { text, hint: '' }
}

/** What to show of a download on its way: a percentage for the bar (null: no bar yet) and a word. */
export function downloadState(r: Pick<Release, 'status' | 'progress' | 'attempts'>): { pct: number | null; text: string } {
  if (r.status === 'wanted') return { pct: null, text: r.attempts ? 'reintentará' : 'en espera' }
  if (r.status !== 'downloading') return { pct: null, text: '' }
  const p = r.progress
  const stage = p?.stage
  if (stage === 'queued') return { pct: null, text: 'en cola' }
  if (stage === 'resolving' || !p?.total) return { pct: null, text: 'preparando…' }
  const pct = Math.min(100, Math.round(100 * (p.fraction ?? p.done / p.total)))
  const songs = p.total > 1 ? `${p.done} de ${p.total} · ` : ''
  const word = stage === 'searching' ? 'buscando' : stage === 'finishing' ? 'terminando' : ''
  return { pct, text: `${songs}${pct} %${word ? ` · ${word}` : ''}` }
}

export const year = (date: string) => (date || '').slice(0, 4)
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']
/** "2023-05-12" → "12 may 2023" (just the year when Deezer only knows that). */
export function fmtDate(date: string): string {
  const [y, m, d] = (date || '').split('-').map(Number)
  if (!y) return ''
  if (!m || !d || m > 12) return String(y)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

const KIND_LABEL: Record<string, string> = { album: 'Álbum', ep: 'EP', single: 'Sencillo', compile: 'Recopilatorio', song: 'Canción suelta' }
export const kindLabel = (kind: string) => KIND_LABEL[kind] || kind

export interface ReleaseGroup { key: string; title: string; releases: Release[] }

/** Albums, EPs, singles, then lives and compilations, each newest first. */
export function groupReleases(releases: Release[]): ReleaseGroup[] {
  const groups: ReleaseGroup[] = [
    { key: 'album', title: 'Álbumes', releases: [] },
    { key: 'ep', title: 'EP', releases: [] },
    { key: 'single', title: 'Sencillos', releases: [] },
    { key: 'other', title: 'Directos y recopilatorios', releases: [] },
    { key: 'song', title: 'Canciones sueltas', releases: [] }
  ]
  for (const r of releases) {
    const other = r.kind === 'compile' || r.reason === 'directo' || r.reason === 'recopilatorio'
    const group = r.kind === 'song' ? groups[4] : other ? groups[3] : groups.find((g) => g.key === r.kind) || groups[3]
    group.releases.push(r)
  }
  for (const g of groups) g.releases.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.release_id - a.release_id)
  return groups.filter((g) => g.releases.length)
}

/** What is going on with a followed artist, in a few words for the sidebar. */
export function followActivity(f: Follow): string {
  const c = f.counts || {}
  if (f.checked === null) return 'Buscando sus discos…'
  if (c.downloading || c.wanted) return `${(c.downloading || 0) + (c.wanted || 0)} por bajar`
  if (c.failed) return `${c.failed} con fallos`
  return ''
}

export interface LibraryArtist { artist_id: number; name: string; picture: string | null; followed: boolean; note: string }

/** Everyone the library has music of: the artists followed, and those with releases or songs here
 * without being followed (asked for by hand, or already in the cloud); by name. */
export function libraryArtists(follows: Follow[], releases: Release[]): LibraryArtist[] {
  const out = new Map<number, LibraryArtist>()
  for (const f of follows) out.set(f.artist_id, { artist_id: f.artist_id, name: f.name, picture: f.picture, followed: true, note: followActivity(f) })
  const counts = new Map<number, { albums: number; songs: number; coming: number; name: string; cover: string | null }>()
  for (const r of releases) {
    if (!r.artist_id || out.has(r.artist_id)) continue
    const c = counts.get(r.artist_id) || { albums: 0, songs: 0, coming: 0, name: r.artist_name || '', cover: null }
    if (r.status !== 'done') c.coming++
    else if (r.kind === 'song') c.songs++
    else c.albums++
    c.name = c.name || r.artist_name || ''
    c.cover = c.cover || r.cover
    counts.set(r.artist_id, c)
  }
  for (const [id, c] of counts) {
    if (!c.name) continue
    const parts = [c.albums && `${c.albums} ${c.albums === 1 ? 'disco' : 'discos'}`, c.songs && `${c.songs} ${c.songs === 1 ? 'canción' : 'canciones'}`,
                   c.coming && `${c.coming} por bajar`].filter(Boolean)
    out.set(id, { artist_id: id, name: c.name, picture: c.cover, followed: false, note: parts.join(' · ') })
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
}

export const isBusy = (follows: Follow[]) => follows.some((f) => f.checked === null || f.counts?.downloading || f.counts?.wanted)

export interface Song {
  /** stable key for the queue: the file's path */
  key: string
  path: string
  title: string
  artist: string
  album: string
  cover: string | null
  duration: number
  releaseId?: number
  /** the album it is on (a loose song's release is not one): where the player's title leads */
  albumId?: number | null
  /** its artist on Deezer: where the player's artist leads */
  artistId?: number | null
  /** the Deezer song, when known (to add it to a playlist) */
  trackId?: number | null
}

/** The playable songs of a downloaded release, with Deezer's durations when the lists line up. */
export function releaseSongs(r: Release | ReleaseDetail): Song[] {
  const files = r.files || []
  const list = 'tracklist' in r && r.tracklist.length === files.length ? r.tracklist : []
  return files.flatMap((f, i) => (f.path ? [{
    key: f.path, path: f.path, title: f.title || songTitle(f.path), artist: f.artist || r.artist_name || '',
    album: r.title, cover: r.cover, duration: f.duration || list[i]?.duration || 0, releaseId: r.release_id, trackId: f.track_id ?? null,
    albumId: albumOf(r) || null, artistId: r.artist_id || null
  }] : []))
}

/** Catalogue songs I have, as player songs (each from wherever it was downloaded). */
export function heldSongs(hits: TrackHit[]): Song[] {
  return hits.flatMap((t) => (t.have === 'done' && t.file ? [{
    key: t.file.path, path: t.file.path, title: t.title, artist: t.artist_name || t.file.artist, album: t.file.album,
    cover: t.file.cover || t.cover, duration: t.duration, releaseId: t.file.release_id, trackId: t.id, albumId: t.album_id, artistId: t.artist_id
  }] : []))
}

/** Where a release card or row leads: its album (a loose song: the album it is from). */
export const albumOf = (r: Pick<Release, 'release_id' | 'kind' | 'album_id'>) => (r.kind === 'song' ? r.album_id || 0 : r.release_id)

/** A playlist's songs as player songs. */
export function playlistSongs(songs: PlaylistSong[]): Song[] {
  return songs.map((s) => ({ key: s.path, path: s.path, title: s.title, artist: s.artist, album: s.album, cover: s.cover,
                             duration: s.duration, releaseId: s.release_id, albumId: s.album_id ?? (s.release_id > 0 ? s.release_id : null),
                             trackId: s.track_id ?? null, artistId: s.artist_id || null }))
}

const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'opus', 'ogg', 'oga', 'flac', 'wav', 'webm', 'wma', 'aiff', 'aif'])
export const isAudioName = (name: string) => AUDIO_EXT.has((name.split('.').pop() || '').toLowerCase())

/** "03 - Título.opus" → "Título"; "Artista - Título.mp3" → "Título". */
export function songTitle(path: string): string {
  const name = (path.split('/').pop() || '').replace(/\.[^.]+$/, '')
  const dash = name.indexOf(' - ')
  return dash > 0 ? name.slice(dash + 3) : name
}
/** "Artista - Título.mp3" → "Artista" (songs in loose folders are named so by soundlift). */
export function songArtist(path: string): string {
  const name = (path.split('/').pop() || '').replace(/\.[^.]+$/, '')
  const dash = name.indexOf(' - ')
  const head = dash > 0 ? name.slice(0, dash) : ''
  return /^\d+$/.test(head) ? '' : head
}

export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

/** The queue when playing `start` out of `pool`: in order from it, or it first and the rest shuffled. */
export function queueFrom(pool: Song[], start: Song | null, shuffle: boolean, random: () => number = Math.random): { queue: Song[]; index: number } {
  if (!pool.length) return { queue: [], index: -1 }
  if (!shuffle) return { queue: [...pool], index: start ? Math.max(0, pool.findIndex((s) => s.key === start.key)) : 0 }
  const first = start || pool[Math.floor(random() * pool.length)]
  return { queue: [first, ...shuffled(pool.filter((s) => s.key !== first.key), random)], index: 0 }
}

export const fmtTime = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '')
export const fmtFans = (n: number | null) =>
  n === null || n === undefined ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} M de fans` : n >= 1e3 ? `${Math.round(n / 1e3)} mil fans` : `${n} fans`

/** What the rules mean in a sentence, e.g. "Álbumes, EP y sencillos desde 2015". */
export function rulesSummary(rules: Rules): string {
  const names = TYPES.filter((t) => rules.types.includes(t.value)).map((t) => t.label.toLowerCase())
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}` : names[0] || ''
  const what = list.charAt(0).toUpperCase() + list.slice(1)
  if (rules.mode === 'since') return `${what} desde ${rules.since_year}`
  if (rules.mode === 'new') return `${what} que saque a partir de ahora`
  return `${what}: toda la discografía`
}
