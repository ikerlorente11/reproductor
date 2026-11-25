/**
 * The music of this device: the folders the app reads (the host scans them and reads every song's tags) and
 * how the pages group it — by artist, by album, by folder. The grouping is pure (no Vue), for tests too;
 * `DeviceLibrary` keeps the host's index reactive.
 */
import { reactive } from 'vue'
import type { Song } from './library.ts'

/** A song of this device as the host's index has it. */
export interface DeviceTrack {
  /** stable between scans (a hash of the path) */
  id: string
  path: string
  size: number
  /** last change, seconds since 1970 */
  mtime: number
  title: string
  artist: string
  /** the album's artist (else the artist) */
  album_artist: string
  album: string
  track: number
  disc: number
  year: number
  genre: string
  /** seconds */
  duration: number
  /** the album's cover in the host (an id it turns into a URL), if any */
  cover: string | null
  /** when it came into the library, seconds since 1970 */
  added: number
}

/** What each platform gives for its music: the index, and how to reach a song or a cover. */
export interface DeviceBackend {
  get(): Promise<{ roots: string[]; tracks: DeviceTrack[]; scanning: boolean }>
  /** looks through the folders again (in the background; `onChanged` says when it is done) */
  scan(): Promise<void>
  /** asks for a folder and adds it; false when none was chosen */
  addRoot(): Promise<boolean>
  removeRoot(path: string): Promise<void>
  /** a song's file in the system's file manager */
  reveal?(path: string): Promise<void>
  /** the text of a `.lrc` next to the song, if there is one */
  lyrics?(id: string): Promise<string | null>
  fileUrl(id: string): string
  coverUrl(cover: string): string
  onProgress(fn: (p: { done: number; total: number }) => void): () => void
  /** the index changed (a scan finished; `error` if it failed) */
  onChanged(fn: (error?: string | null) => void): () => void
}

/** The key of a device song in the queue, likes and playlists (cloud songs are keyed by their path). */
export const deviceKey = (id: string) => `dev:${id}`
export const isDeviceKey = (key: string) => key.startsWith('dev:')

export function deviceSong(t: DeviceTrack, coverUrl: (cover: string) => string, albumKey = albumKeyOf(t)): Song {
  return {
    key: deviceKey(t.id), path: t.path, title: t.title, artist: t.artist, album: t.album,
    cover: t.cover ? coverUrl(t.cover) : null, duration: t.duration, device: t.id,
    albumKey, artistName: t.album_artist || t.artist
  }
}

const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/**
 * The album a song is on, as a key: its album artist and name. Without an album artist in the tags, the song's
 * artist and name, unless its folder holds that album by several artists (a compilation tagged per song): then
 * the folder and name. A song with no album tag: its folder. `mixed`: the folders+albums with several artists.
 */
export function albumKeyOf(t: Pick<DeviceTrack, 'album_artist' | 'artist' | 'album' | 'path'>, mixed?: Set<string>): string {
  const album = plain(t.album)
  const folder = folderOf(t.path).toLowerCase()
  if (!album) return `\u0002${folder}`
  if (t.album_artist) return `${plain(t.album_artist)}\u0001${album}`
  return mixed?.has(`${folder}\u0001${album}`) ? `\u0003${folder}\u0001${album}` : `${plain(t.artist)}\u0001${album}`
}

/** Every song's album key (see albumKeyOf), by the song's id. */
export function albumKeys(tracks: DeviceTrack[]): Map<string, string> {
  const artists = new Map<string, Set<string>>()
  for (const t of tracks) {
    if (t.album_artist || !t.album) continue
    const k = `${folderOf(t.path).toLowerCase()}\u0001${plain(t.album)}`
    const set = artists.get(k) || new Set<string>()
    set.add(plain(t.artist))
    artists.set(k, set)
  }
  const mixed = new Set([...artists].filter(([, set]) => set.size > 1).map(([k]) => k))
  return new Map(tracks.map((t) => [t.id, albumKeyOf(t, mixed)]))
}

export const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')

export interface DeviceAlbum {
  key: string
  title: string
  artist: string
  year: number
  cover: string | null
  tracks: DeviceTrack[]
  duration: number
  /** the newest song's arrival (for «Añadido hace poco») */
  added: number
}

export interface DeviceArtist {
  name: string
  albums: DeviceAlbum[]
  /** every song of theirs: on their albums and as guest artist on others */
  tracks: DeviceTrack[]
  cover: string | null
}

const byNumber = (a: DeviceTrack, b: DeviceTrack) => (a.disc || 1) - (b.disc || 1) || (a.track || 999) - (b.track || 999) || a.path.localeCompare(b.path, 'es', { numeric: true })
const byName = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true })

/** The albums, each with its songs in order (disc, then number); by artist and year. */
export function deviceAlbums(tracks: DeviceTrack[], keys = albumKeys(tracks)): DeviceAlbum[] {
  const out = new Map<string, DeviceAlbum>()
  for (const t of tracks) {
    const key = keys.get(t.id)!
    let a = out.get(key)
    if (!a) {
      a = { key, title: t.album || '', artist: t.album_artist || t.artist, year: 0, cover: null, tracks: [], duration: 0, added: 0 }
      out.set(key, a)
    }
    a.tracks.push(t)
    a.year = Math.max(a.year, t.year || 0)
    a.cover = a.cover || t.cover
    a.duration += t.duration || 0
    a.added = Math.max(a.added, t.added || 0)
  }
  for (const a of out.values()) {
    a.tracks.sort(byNumber)
    // without an album artist, the songs' one; if they differ (a compilation tagged per song), «Varios artistas»
    if (!a.tracks[0].album_artist && new Set(a.tracks.map((t) => plain(t.artist))).size > 1) a.artist = 'Varios artistas'
  }
  return [...out.values()].sort((a, b) => byName(a.artist, b.artist) || a.year - b.year || byName(a.title, b.title))
}

/** The names a song's artist field holds ("A, B feat. C" → A, B, C). */
export function splitArtists(name: string): string[] {
  // not «/» nor «&»: they are part of names (AC/DC, Simon & Garfunkel)
  return name.split(/\s*(?:;|,|\s(?:feat\.?|ft\.?|featuring|con|with)\s)\s*/i).map((s) => s.trim()).filter(Boolean)
}

/** The artists: whoever has an album here (by album artist), and on whose albums the songs are. */
export function deviceArtists(tracks: DeviceTrack[], albums = deviceAlbums(tracks)): DeviceArtist[] {
  const out = new Map<string, DeviceArtist>()
  const get = (name: string) => {
    const key = plain(name)
    let a = out.get(key)
    if (!a) { a = { name, albums: [], tracks: [], cover: null }; out.set(key, a) }
    return a
  }
  for (const album of albums) {
    if (album.artist === 'Varios artistas' || !album.artist) continue
    const a = get(album.artist)
    a.albums.push(album)
    a.cover = a.cover || album.cover
  }
  for (const t of tracks) {
    const names = new Set([t.album_artist, ...splitArtists(t.artist)].filter(Boolean).map((n) => n.trim()))
    for (const n of names) {
      const a = out.get(plain(n))
      if (a) a.tracks.push(t)
      else if (!t.album_artist || plain(t.album_artist) === 'varios artistas' || plain(t.album_artist) === 'various artists') get(n).tracks.push(t)
    }
  }
  for (const a of out.values()) {
    a.albums.sort((x, y) => y.year - x.year || byName(x.title, y.title))
    a.cover = a.cover || a.tracks.find((t) => t.cover)?.cover || null
  }
  return [...out.values()].filter((a) => a.tracks.length).sort((x, y) => byName(x.name, y.name))
}

/** What is right inside `dir` (a root or one of its folders): its folders and its songs. */
export function deviceFolder(tracks: DeviceTrack[], dir: string): { folders: { path: string; name: string; count: number }[]; tracks: DeviceTrack[] } {
  const sep = dir.includes('\\') ? '\\' : '/'
  const base = dir.replace(/[\\/]+$/, '') + sep
  const lower = base.toLowerCase()
  const folders = new Map<string, { path: string; name: string; count: number }>()
  const here: DeviceTrack[] = []
  for (const t of tracks) {
    if (!t.path.toLowerCase().startsWith(lower)) continue
    const rest = t.path.slice(base.length)
    const cut = rest.search(/[\\/]/)
    if (cut < 0) { here.push(t); continue }
    const name = rest.slice(0, cut)
    const f = folders.get(name.toLowerCase()) || { path: base + name, name, count: 0 }
    f.count++
    folders.set(name.toLowerCase(), f)
  }
  return {
    folders: [...folders.values()].sort((a, b) => byName(a.name, b.name)),
    tracks: here.sort((a, b) => byNumber(a, b))
  }
}

/** Songs that match every word of `q` (title, artist, album; accents and case aside), title matches first. */
export function searchTracks(tracks: DeviceTrack[], q: string): DeviceTrack[] {
  const words = plain(q).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const title = words.join(' ')
  return tracks
    .filter((t) => { const text = plain(`${t.title} ${t.artist} ${t.album_artist} ${t.album}`); return words.every((w) => text.includes(w)) })
    .sort((a, b) => Number(!plain(a.title).includes(title)) - Number(!plain(b.title).includes(title)))
}

export const matchesName = (name: string, q: string) => { const w = plain(q).split(/\s+/).filter(Boolean); const n = plain(name); return w.length > 0 && w.every((x) => n.includes(x)) }

/** The index of this device, kept up to date by the host's events. */
export class DeviceLibrary {
  readonly state = reactive({
    roots: [] as string[],
    tracks: [] as DeviceTrack[],
    scanning: false,
    progress: { done: 0, total: 0 },
    loaded: false,
    error: ''
  })
  private albumsCache: { tracks: DeviceTrack[] | null; keys: Map<string, string>; albums: DeviceAlbum[]; artists: DeviceArtist[] } =
    { tracks: null, keys: new Map(), albums: [], artists: [] }

  readonly backend: DeviceBackend

  constructor(backend: DeviceBackend) {
    this.backend = backend
    backend.onProgress((p) => { this.state.progress = p; this.state.scanning = p.done < p.total || p.total === 0 })
    backend.onChanged((error) => { this.state.error = error || ''; this.load() })
  }

  async load(): Promise<void> {
    const got = await this.backend.get()
    this.state.roots = got.roots
    this.state.tracks = Object.freeze(got.tracks) as DeviceTrack[]
    this.state.scanning = got.scanning
    this.state.loaded = true
  }

  /** Loads the index as it was and looks through the folders for what changed since. */
  async start(): Promise<void> {
    await this.load()
    await this.backend.scan()
    this.state.scanning = true
  }

  private grouped() {
    if (this.albumsCache.tracks !== this.state.tracks) {
      const keys = albumKeys(this.state.tracks)
      const albums = deviceAlbums(this.state.tracks, keys)
      this.albumsCache = { tracks: this.state.tracks, keys, albums, artists: deviceArtists(this.state.tracks, albums) }
    }
    return this.albumsCache
  }
  get albums(): DeviceAlbum[] { return this.grouped().albums }
  get artists(): DeviceArtist[] { return this.grouped().artists }
  album(key: string): DeviceAlbum | undefined { return this.albums.find((a) => a.key === key) }
  artist(name: string): DeviceArtist | undefined { const k = plain(name); return this.artists.find((a) => plain(a.name) === k) }

  song(t: DeviceTrack): Song { return deviceSong(t, (c) => this.backend.coverUrl(c), this.grouped().keys.get(t.id)) }
  songs(tracks: DeviceTrack[]): Song[] { return tracks.map((t) => this.song(t)) }
  cover(cover: string | null): string | null { return cover ? this.backend.coverUrl(cover) : null }
}
