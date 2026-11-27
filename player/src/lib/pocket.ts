/**
 * El Reproductor without a server («de bolsillo»): an app not connected to one still searches Deezer's catalogue, opens
 * any artist, album or Deezer playlist, listens to it from YouTube Music, and downloads what one wants to the device,
 * keeping the artists one downloads up to date (their new releases come down by themselves).
 *
 * It answers the pages as the service does (the same /api/… routes and shapes: el_archivador's reproductor/service,
 * app.py), here in the app: Deezer asked through the app's own fetch (Deezer does not let a web page ask it), each song
 * downloaded by the app (`PocketHost.download`: found on YouTube Music, tagged, into the device's music), what one
 * downloads and its rules kept on this device (IndexedDB). The download goes on while the app is open.
 * What needs a server (devices, the cloud's playlists, history shared, Spotify…) is not here: those routes answer 404.
 */
import { Api, type Artist, type DeliveredFile, type Follow, type HeldFile, type Mode, type Release, type Status, type TrackHit } from './api.ts'
import { trackInfo } from './deezer.ts'
import { decide, DEFAULT_TYPES, recordingKeys, sameArtist, type Disc, type DiscTrack } from './discography.ts'

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

/** A song to download, with its tags; `folder` («Artist/Album») and `file` (its name, without extension) under the
 *  device's music folder. */
export interface PocketSong {
  artist: string
  title: string
  duration: number
  isrc: string | null
  album: string
  albumArtist: string
  track: number
  disc: number
  tracks: number
  year: string
  cover: string | null
  folder: string
  file: string
}
/** What the app does for it: downloads a song to the device (its `path`, as the app plays and deletes it) and deletes. */
export interface PocketHost {
  download(song: PocketSong): Promise<{ path: string }>
  remove(paths: string[]): Promise<void>
}

const DEEZER = 'https://api.deezer.com'
const GAP_MS = 120                 // ~8 requests a second, under Deezer's 50 every 5 s
const PAGE = 100
const SEARCH_POOL = 50
const H = 3600e3
const TTL: Record<string, number> = { search: H, artist: 24 * H, albums: 24 * H, tracks: 30 * 24 * H, track: 7 * 24 * H, album: 24 * H, playlist: H }
/** kept on the device too (the rest only while the app runs) */
const PERSIST = new Set(['tracks', 'album', 'track'])
/** a followed artist looked at again after this long (their new releases) */
const CHECK_EVERY_MS = 20 * H
const PARALLEL = 6

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- a small store on the device (IndexedDB) ----
let dbOpen: Promise<IDBDatabase> | null = null
function idb(): Promise<IDBDatabase> {
  return (dbOpen ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('reproductor.pocket', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}
async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await idb()
    return await new Promise<T | undefined>((resolve) => {
      const q = db.transaction('kv').objectStore('kv').get(key)
      q.onsuccess = () => resolve(q.result as T | undefined)
      q.onerror = () => resolve(undefined)
    })
  } catch (_) { return undefined }
}
async function kvPut(key: string, value: unknown) {
  try { (await idb()).transaction('kv', 'readwrite').objectStore('kv').put(value, key) } catch (_) {}
}

// ---- Deezer's public API (the service's deezer.py) ----
const artistSummary = (d: any): Artist => ({ id: d.id, name: d.name, picture: d.picture_medium || null, fans: d.nb_fan ?? null, albums: d.nb_album ?? null })
const albumSummary = (d: any) => ({
  id: d.id, title: d.title || '', cover: d.cover_medium || null, kind: d.record_type || 'album', date: d.release_date || '',
  artist_id: d.artist?.id ?? null, artist_name: d.artist?.name || '', tracks: d.nb_tracks ?? null
})
const trackSummary = (d: any) => ({
  id: d.id, title: d.title || '', duration: d.duration || 0, isrc: d.isrc || null, artist_id: d.artist?.id ?? null,
  artist_name: d.artist?.name || '', album_id: d.album?.id ?? null, album_title: d.album?.title || '', cover: d.album?.cover_medium || null,
  link: d.link || `https://www.deezer.com/track/${d.id}`
})
const playlistSummary = (d: any) => ({ id: d.id, title: d.title || '', cover: d.picture_medium || null, tracks: d.nb_tracks ?? null, owner: (d.user || d.creator)?.name || '' })
const plainText = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).join(' ').trim()

/** Deezer puts namesakes with a handful of fans before the band everyone means: the name matching what was typed
 *  first (exactly, then starting with it, then containing it), and within each, the most listened. */
function rankArtists(query: string, artists: Artist[]): Artist[] {
  const q = plainText(query)
  const tier = (name: string) => { const n = plainText(name); return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3 }
  return [...artists].sort((a, b) => tier(a.name) - tier(b.name) || (b.fans || 0) - (a.fans || 0))
}

class Deezer {
  private next = 0
  private memory = new Map<string, { until: number; value: any }>()
  constructor(private open: Fetcher) {}

  async get(path: string): Promise<any> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const at = Math.max(Date.now(), this.next)
      this.next = at + GAP_MS
      if (at > Date.now()) await sleep(at - Date.now())
      let data: any
      try {
        data = await (await this.open(DEEZER + path)).json()
      } catch (err: any) {
        if (attempt === 2) throw new HttpError(502, `Deezer no responde: ${err?.message || err}`)
        await sleep(2000)
        continue
      }
      const error = data?.error
      if (!error) return data
      if (error.code === 4 && attempt < 2) { await sleep(5000); continue }   // its quota: a pause, and again
      if (error.code === 800 || /no data/i.test(String(error.message || ''))) throw new HttpError(404, 'Deezer no lo tiene')
      throw new HttpError(502, `Deezer: ${error.message || error}`)
    }
    throw new HttpError(502, 'Deezer no responde')
  }

  async pages(path: string): Promise<any[]> {
    const out: any[] = []
    const sep = path.includes('?') ? '&' : '?'
    for (;;) {
      const data = await this.get(`${path}${sep}limit=${PAGE}&index=${out.length}`)
      const page: any[] = data.data || []
      out.push(...page)
      if (!page.length || !data.next || out.length >= (data.total ?? out.length)) return out
    }
  }

  async cached<T>(kind: string, path: string, fetch: (path: string) => Promise<T>, fresh = false): Promise<T> {
    const now = Date.now()
    if (!fresh) {
      const hit = this.memory.get(path)
      if (hit && hit.until > now) return hit.value
      if (PERSIST.has(kind)) {
        const stored = await kvGet<{ until: number; value: T }>(`dz:${path}`)
        if (stored && stored.until > now) { this.memory.set(path, stored); return stored.value }
      }
    }
    const value = await fetch(path)
    if (this.memory.size > 3000) this.memory.clear()
    const entry = { until: now + TTL[kind], value }
    this.memory.set(path, entry)
    if (PERSIST.has(kind)) kvPut(`dz:${path}`, entry)
    return value
  }

  private list = (path: string) => this.get(path).then((d) => d.data || [])
  searchArtists = async (q: string) => rankArtists(q, (await this.cached('search', `/search/artist?q=${encodeURIComponent(q)}&limit=${SEARCH_POOL}`, this.list)).map(artistSummary)).slice(0, 20)
  searchAlbums = async (q: string) => (await this.cached('search', `/search/album?q=${encodeURIComponent(q)}&limit=20`, this.list)).map(albumSummary)
  searchTracks = async (q: string) => (await this.cached('search', `/search/track?q=${encodeURIComponent(q)}&limit=25`, this.list)).map(trackSummary)
  searchPlaylists = async (q: string) => (await this.cached('search', `/search/playlist?q=${encodeURIComponent(q)}&limit=20`, this.list)).map(playlistSummary)
  topTracks = async (id: number, limit: number) => (await this.cached('artist', `/artist/${id}/top?limit=${limit}`, this.list)).map(trackSummary)
  artistRaw = (id: number) => this.cached('artist', `/artist/${id}`, (p) => this.get(p))
  albumRaw = (id: number) => this.cached('album', `/album/${id}`, (p) => this.get(p))
  trackRaw = (id: number) => this.cached('track', `/track/${id}`, (p) => this.get(p))
  albumTracksRaw = (id: number) => this.cached('tracks', `/album/${id}/tracks`, (p) => this.pages(p))
  albumList = (artistId: number, fresh = false) => this.cached('albums', `/artist/${artistId}/albums`, (p) => this.pages(p), fresh)

  async albumSongs(id: number) {
    const album = await this.albumRaw(id)
    return (await this.albumTracksRaw(id)).map((t: any) => trackSummary({ ...t, album: { id, title: album.title, cover_medium: album.cover_medium } }))
  }
  async playlist(id: number) {
    const info = await this.cached('playlist', `/playlist/${id}`, (p) => this.get(p))
    const tracks = await this.cached('playlist', `/playlist/${id}/tracks`, (p) => this.pages(p))
    return { ...playlistSummary(info), description: info.description || '', songs: tracks.filter((t: any) => t.readable !== false).map(trackSummary) }
  }
  /** Every release of the artist with its songs (`fresh`: the list of releases asked again, the songs from the cache). */
  async releases(artistId: number, fresh = false): Promise<Disc[]> {
    const albums = await this.albumList(artistId, fresh)
    const tracks: DiscTrack[][] = new Array(albums.length)
    let next = 0
    await Promise.all(Array.from({ length: Math.min(PARALLEL, albums.length) }, async () => {
      for (let i = next++; i < albums.length; i = next++) {
        tracks[i] = (await this.albumTracksRaw(albums[i].id)).map((t: any) => ({ id: t.id, title: t.title || '', isrc: t.isrc || null, duration: t.duration || 0 }))
      }
    }))
    return albums.map((a: any, i: number) => ({ id: a.id, title: a.title, kind: a.record_type || 'album', date: a.release_date || '', tracks: tracks[i], cover: a.cover_medium || null }))
  }
}

// ---- what is kept: the artists downloaded (with their rules) and every release asked for ----
interface FollowRow { artist_id: number; name: string; picture: string | null; mode: Mode; since_year: number | null; types: string[]
                      followed_on: string; checked: number | null; check_error: string | null }
interface Row extends Release {
  /** the recordings it has (to know a song had, or on its way) */
  keys: string[]
  /** a loose song's album */
  album_title?: string
  /** when it was asked for (the order downloads go in) */
  queued: number
}
interface Kept { follows: Record<number, FollowRow>; rows: Record<number, Row> }

const KEYS_OUT = new Set(['keys', 'album_title', 'queued'])
const now = () => Date.now() / 1000
const today = () => new Date().toISOString().slice(0, 10)
/** A name fit for a folder or a file on any system. */
const safe = (s: string) => (s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 100) || 'Sin título'

/** What one has of each recording: downloaded (and where), or on its way (the service's holdings.py). */
class Holdings {
  private done = new Map<string, { file: HeldFile; artist: string }[]>()
  private coming = new Map<string, string[]>()
  constructor(rows: Row[]) {
    for (const r of rows) {
      if (r.status === 'wanted' || r.status === 'downloading') for (const k of r.keys) this.coming.set(k, [...(this.coming.get(k) || []), r.artist_name || ''])
      if (r.status !== 'done') continue
      for (const f of r.files || []) {
        if (!f.path) continue
        const file: HeldFile = { path: f.path, release_id: r.release_id, title: f.title, artist: f.artist, album: r.kind === 'song' ? r.album_title || '' : r.title, cover: r.cover }
        for (const k of recordingKeys({ title: f.title, isrc: f.isrc || null, duration: f.duration || 0 })) this.done.set(k, [...(this.done.get(k) || []), { file, artist: f.artist }])
      }
    }
  }
  song(t: { title: string; isrc?: string | null; duration: number; artist_name: string }): Pick<TrackHit, 'have' | 'file'> {
    const keys = recordingKeys({ title: t.title, isrc: t.isrc || null, duration: t.duration })
    for (const k of keys) {
      const had = (this.done.get(k) || []).find((e) => k.startsWith('i:') || sameArtist(e.artist, t.artist_name))
      if (had) return { have: 'done', file: had.file }
    }
    for (const k of keys) if ((this.coming.get(k) || []).some((a) => k.startsWith('i:') || sameArtist(a, t.artist_name))) return { have: 'coming', file: null }
    return { have: null, file: null }
  }
}

export class Pocket {
  readonly api: Api
  private dz: Deezer
  private kept: Kept = { follows: {}, rows: {} }
  private ready: Promise<void>
  private running = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(open: Fetcher, private host: PocketHost | null) {
    this.dz = new Deezer(open)
    this.api = new Api('http://pocket.invalid', () => '')
    this.api.pocket = true
    this.api.fetch = (input, init) => this.answer(String(input), init || {})
    this.ready = this.load()
  }

  /** Whether it can download (the app knows how), else only search and listen. */
  get downloads(): boolean { return !!this.host }

  private async load() {
    const kept = await kvGet<Kept>('state')
    if (kept) this.kept = kept
    // what was under way when the app closed starts again
    for (const r of Object.values(this.kept.rows)) if (r.status === 'downloading') { r.status = 'wanted'; r.progress = null }
    setTimeout(() => { this.checkDue(); this.pump() }, 3000)
  }
  private save() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => kvPut('state', JSON.parse(JSON.stringify(this.kept))), 300)
  }
  private rows(): Row[] { return Object.values(this.kept.rows) }
  private holdings() { return new Holdings(this.rows()) }
  private marked<T extends { title: string; isrc?: string | null; duration: number; artist_name: string }>(t: T, h = this.holdings()): T & Pick<TrackHit, 'have' | 'file'> {
    return { ...t, ...h.song(t) }
  }
  private public(r: Row, lite = false): Release {
    const out: any = { followed: !!this.kept.follows[r.artist_id] }
    for (const [k, v] of Object.entries(r)) if (!KEYS_OUT.has(k) && !(lite && k === 'files')) out[k] = v
    return out
  }
  private publicFollow(f: FollowRow): Follow {
    const counts: Partial<Record<Status, number>> = {}
    for (const r of this.rows()) if (r.artist_id === f.artist_id) counts[r.status] = (counts[r.status] || 0) + 1
    return { ...f, types: f.types as any, counts }
  }
  private touch(r: Row, change: Partial<Row>) { Object.assign(r, change, { updated: now() }); this.save() }

  // ---- the routes (as app.py) ----
  private async answer(url: string, init: RequestInit): Promise<Response> {
    await this.ready
    const u = new URL(url)
    const q = u.searchParams
    const method = (init.method || 'GET').toUpperCase()
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {}
    try {
      const value = await this.route(method, u.pathname, q, body)
      return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500
      return new Response(JSON.stringify({ detail: err?.message || String(err) }), { status, headers: { 'Content-Type': 'application/json' } })
    }
  }

  private async route(method: string, path: string, q: URLSearchParams, body: any): Promise<unknown> {
    let m: RegExpMatchArray | null
    const id = () => Number(m![1])
    const get = method === 'GET'
    const post = method === 'POST'
    if (get && path === '/api/cloud') return { connected: true, username: '' }
    if (get && path === '/api/search') {
      const follows = this.kept.follows
      return (await this.dz.searchArtists(q.get('q')!.trim())).map((a) => ({ ...a, followed: !!follows[a.id] }))
    }
    if (get && path === '/api/search/albums') return (await this.dz.searchAlbums(q.get('q')!.trim())).map((a: any) => ({ ...a, status: this.kept.rows[a.id]?.status ?? null }))
    if (get && path === '/api/search/tracks') { const h = this.holdings(); return (await this.dz.searchTracks(q.get('q')!.trim())).map((t: any) => this.marked(t, h)) }
    if (get && path === '/api/search/playlists') return this.dz.searchPlaylists(q.get('q')!.trim())
    if (get && (m = path.match(/^\/api\/artists\/(\d+)\/top$/))) { const h = this.holdings(); return (await this.dz.topTracks(id(), Math.min(50, Number(q.get('limit') || 10)))).map((t: any) => this.marked(t, h)) }
    if (get && (m = path.match(/^\/api\/artists\/(\d+)$/))) return this.artistPage(id(), q.get('quick') === 'true')
    if (get && (m = path.match(/^\/api\/albums\/(\d+)$/))) return this.albumPage(id())
    if (get && (m = path.match(/^\/api\/deezer\/playlists\/(\d+)$/))) {
      const info = await this.dz.playlist(id())
      const h = this.holdings()
      return { ...info, songs: info.songs.map((t: any) => this.marked(t, h)) }
    }
    if (post && (m = path.match(/^\/api\/deezer\/playlists\/(\d+)\/download$/))) {
      const info = await this.dz.playlist(id())
      const h = this.holdings()
      let asked = 0
      for (const t of info.songs) if (!h.song(t).have) { await this.looseSong(t.id); asked++ }
      this.pump()
      return { asked }
    }
    if (get && (m = path.match(/^\/api\/songs\/(\d+)\/info$/))) {
      const data = await this.dz.trackRaw(id())
      const album = data.album?.id ? await this.dz.albumRaw(data.album.id).catch(() => null) : null
      return trackInfo(data, album)
    }
    if (post && (m = path.match(/^\/api\/songs\/(\d+)\/download$/))) {
      this.canDownload()
      const t = trackSummary(await this.dz.trackRaw(id()))
      if (this.holdings().song(t).have) throw new HttpError(409, 'Ya la tienes o está bajando')
      const row = await this.looseSong(id())
      this.pump()
      return this.public(row)
    }
    // ---- the artists downloaded ----
    if (get && path === '/api/follows') return Object.values(this.kept.follows).map((f) => this.publicFollow(f))
    if (post && path === '/api/follows') {
      this.canDownload()
      if (this.kept.follows[body.artist_id]) throw new HttpError(409, 'Ya descargas a ese artista')
      const a = artistSummary(await this.dz.artistRaw(body.artist_id))
      const f: FollowRow = { artist_id: a.id, name: a.name, picture: a.picture, mode: body.mode || 'all', since_year: body.since_year ?? null,
                             types: body.types || DEFAULT_TYPES, followed_on: today(), checked: null, check_error: null }
      this.kept.follows[a.id] = f
      this.save()
      this.check(f)
      return this.publicFollow(f)
    }
    if (method === 'PUT' && (m = path.match(/^\/api\/follows\/(\d+)$/))) {
      const f = this.followOf(id())
      Object.assign(f, { mode: body.mode, since_year: body.since_year ?? null, types: body.types, checked: null })
      this.save()
      this.check(f)
      return this.publicFollow(f)
    }
    if (method === 'DELETE' && (m = path.match(/^\/api\/follows\/(\d+)$/))) {
      this.followOf(id())
      delete this.kept.follows[id()]
      // what the rules had chosen and is not down yet is forgotten; what was downloaded stays
      for (const r of this.rows()) if (r.artist_id === id() && !r.manual && (r.status === 'wanted' || r.status === 'skipped' || r.status === 'failed')) delete this.kept.rows[r.release_id]
      this.save()
      return { unfollowed: id() }
    }
    if (post && path === '/api/follows/check') {
      const due = Object.values(this.kept.follows)
      due.forEach((f) => { f.checked = null })
      this.checkAll(due)
      return { checking: due.length }
    }
    // ---- releases ----
    if (get && path === '/api/releases') {
      const status = q.get('status')
      const artist = Number(q.get('artist') || 0)
      let out = this.rows().filter((r) => (!status || r.status === status) && (!artist || r.artist_id === artist))
      out.sort((a, b) => (q.get('recent') ? (b.updated || 0) - (a.updated || 0) : b.date.localeCompare(a.date)))
      if (q.get('limit')) out = out.slice(0, Number(q.get('limit')))
      return out.map((r) => this.public(r, q.get('lite') === 'true'))
    }
    if (get && path === '/api/downloads') {
      const rows = this.rows()
      const since = now() - 24 * 3600
      const slim = (r: Row) => this.public(r, true)
      return {
        active: [...rows.filter((r) => r.status === 'downloading'), ...this.waiting()].map(slim),
        waiting: 0,
        failed: rows.filter((r) => r.status === 'failed').map(slim),
        recent: rows.filter((r) => r.status === 'done' && (r.updated || 0) >= since).sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 30).map(slim)
      }
    }
    if (get && (m = path.match(/^\/api\/releases\/(-?\d+)$/))) {
      const r = this.rowOf(id())
      const tracklist = r.release_id > 0 ? await this.dz.albumTracksRaw(r.release_id).then((ts) => ts.map((t: any) => ({ title: t.title || '', duration: t.duration || 0 }))).catch(() => []) : []
      return { ...this.public(r), tracklist }
    }
    if (post && (m = path.match(/^\/api\/releases\/(-?\d+)\/(download|skip|cancel|auto)$/))) return this.choose(Number(m[1]), m[2])
    if (post && path === '/api/forget') return this.forget(body.paths || [])
    // ---- what only a server has: empty, so the pages show nothing of it ----
    if (get && ['/api/playlists', '/api/plays', '/api/plays/top', '/api/unplaced', '/api/sessions'].includes(path)) return []
    throw new HttpError(404, 'Sin servidor no se puede')
  }

  private canDownload() { if (!this.host) throw new HttpError(501, 'Esta versión de la app aún no descarga sin servidor') }
  private followOf(artistId: number): FollowRow {
    const f = this.kept.follows[artistId]
    if (!f) throw new HttpError(404, 'No descargas a ese artista')
    return f
  }
  private rowOf(releaseId: number): Row {
    const r = this.kept.rows[releaseId]
    if (!r) throw new HttpError(404, 'Lanzamiento no encontrado')
    return r
  }

  private async artistPage(artistId: number, quick: boolean) {
    const info = artistSummary(await this.dz.artistRaw(artistId))
    const f = this.kept.follows[artistId]
    const mineRows = this.rows().filter((r) => r.artist_id === artistId)
    if (f && (mineRows.length || f.checked !== null)) {
      return { ...info, follow: this.publicFollow(f), releases: mineRows.sort((a, b) => b.date.localeCompare(a.date)).map((r) => this.public(r)) }
    }
    const mine = new Map(mineRows.map((r) => [r.release_id, this.public(r)]))
    if (quick) {
      const listed = [...await this.dz.albumList(artistId)].sort((a: any, b: any) => (b.release_date || '').localeCompare(a.release_date || ''))
      const releases = listed.map((a: any) => {
        const own = mine.get(a.id)
        mine.delete(a.id)
        return own || { release_id: a.id, artist_id: artistId, title: a.title, kind: a.record_type || 'album', date: a.release_date || '', cover: a.cover_medium || null,
                        tracks: null, reason: '', status: 'preview-pending' }
      })
      return { ...info, follow: f ? this.publicFollow(f) : null, releases: [...releases, ...mine.values()] }
    }
    const found = await this.dz.releases(artistId)
    const decisions = new Map(decide(found).map((d) => [d.release, d]))
    const releases = [...found].sort((a, b) => b.date.localeCompare(a.date)).map((r) => {
      const own = mine.get(r.id)
      mine.delete(r.id)
      const d = decisions.get(r.id)!
      return own || { release_id: r.id, artist_id: artistId, title: r.title, kind: r.kind, date: r.date, cover: r.cover, tracks: r.tracks.length,
                      reason: d.reason, status: d.wanted ? 'preview-wanted' : 'preview-skipped' }
    })
    return { ...info, follow: f ? this.publicFollow(f) : null, releases: [...releases, ...mine.values()] }
  }

  private async albumPage(albumId: number) {
    const info = albumSummary(await this.dz.albumRaw(albumId))
    const h = this.holdings()
    const songs = (await this.dz.albumSongs(albumId)).map((t: any) => this.marked(t, h))
    const mine = this.kept.rows[albumId]
    return { ...info, mine: mine ? this.public(mine) : null, songs, followed: info.artist_id ? !!this.kept.follows[info.artist_id] : false }
  }

  // ---- asking for downloads ----
  private newRow(d: { id: number; title: string; kind: string; date: string; cover: string | null }, artistId: number, artistName: string,
                 tracks: DiscTrack[], status: Status, reason: string, manual: number): Row {
    return { release_id: d.id, artist_id: artistId, artist_name: artistName, title: d.title, kind: d.kind, date: d.date, cover: d.cover,
             tracks: tracks.length, status, reason, manual, attempts: 0, result: null, error: null, files: null, track_id: null, album_id: null,
             progress: null, updated: now(), keys: tracks.flatMap(recordingKeys), queued: now() }
  }
  /** One release of the catalogue, asked for by hand (its artist not downloaded). */
  private async looseRelease(albumId: number): Promise<Row> {
    const a = await this.dz.albumRaw(albumId)
    const tracks = (await this.dz.albumTracksRaw(albumId)).map((t: any) => ({ id: t.id, title: t.title || '', isrc: t.isrc || null, duration: t.duration || 0 }))
    const row = this.newRow({ id: albumId, title: a.title || '', kind: a.record_type || 'album', date: a.release_date || '', cover: a.cover_medium || null },
                            a.artist?.id || 0, a.artist?.name || '', tracks, 'wanted', 'lo pediste tú', 1)
    this.kept.rows[albumId] = row
    this.save()
    return row
  }
  /** One song on its own (it goes to its album's folder). */
  private async looseSong(trackId: number): Promise<Row> {
    const t = await this.dz.trackRaw(trackId)
    const track: DiscTrack = { id: t.id, title: t.title || '', isrc: t.isrc || null, duration: t.duration || 0 }
    const row = this.newRow({ id: -trackId, title: t.title || '', kind: 'song', date: t.release_date || t.album?.release_date || '', cover: t.album?.cover_medium || null },
                            t.artist?.id || 0, t.artist?.name || '', [track], 'wanted', 'lo pediste tú', 1)
    Object.assign(row, { track_id: trackId, album_id: t.album?.id || null, album_title: t.album?.title || '' })
    this.kept.rows[-trackId] = row
    this.save()
    return row
  }

  private async choose(releaseId: number, choice: string): Promise<Release> {
    const r = this.kept.rows[releaseId]
    if (choice === 'download') {
      this.canDownload()
      if (r?.status === 'done') {
        // downloaded with songs missing: those, each on its own
        const h = this.holdings()
        const missing = (await this.dz.albumSongs(releaseId)).filter((t: any) => !h.song(t).have)
        if (!missing.length) throw new HttpError(409, 'Ya lo tienes entero')
        for (const t of missing) await this.looseSong(t.id)
        this.pump()
        return this.public(r)
      }
      if (r?.status === 'downloading') throw new HttpError(409, 'Se está descargando')
      const row = r ? (this.touch(r, { status: 'wanted', manual: 1, attempts: 0, error: null, queued: now() }), r) : await this.looseRelease(releaseId)
      this.pump()
      return this.public(row)
    }
    if (!r) throw new HttpError(404, 'Lanzamiento no encontrado')
    if (choice === 'skip') {
      if (r.status === 'downloading' || r.status === 'done') throw new HttpError(409, 'Ya está descargado o descargándose')
      this.touch(r, { status: 'skipped', manual: -1, reason: 'lo quitaste tú' })
    } else if (choice === 'cancel') {
      if (r.status !== 'wanted' && r.status !== 'downloading') throw new HttpError(409, 'No se está descargando')
      this.touch(r, { status: 'skipped', manual: -1, reason: 'lo cancelaste', progress: null })
    } else {
      if (!['wanted', 'skipped', 'failed'].includes(r.status)) throw new HttpError(409, 'Ya está descargado o descargándose')
      this.touch(r, { status: 'skipped', manual: 0, attempts: 0, error: null })
      const f = this.kept.follows[r.artist_id]
      if (f) await this.check(f)
    }
    return this.public(r)
  }

  /** Files deleted from the device: out of their releases (one left with none is not downloaded again). */
  private forget(paths: string[]) {
    const gone = new Set(paths)
    let touched = 0
    for (const r of this.rows()) {
      const files = r.files || []
      if (!files.some((f) => f.path && gone.has(f.path))) continue
      const keep = files.filter((f) => !(f.path && gone.has(f.path)))
      if (keep.some((f) => f.path)) this.touch(r, { files: keep })
      else this.touch(r, { status: 'skipped', manual: -1, reason: 'lo borraste tú', files: [], result: null })
      touched++
    }
    return { releases: touched }
  }

  // ---- the artists downloaded: their releases, and the new ones ----
  private async check(f: FollowRow) {
    try {
      const found = await this.dz.releases(f.artist_id, true)
      for (const d of decide(found, f.types, f.mode, f.since_year, f.followed_on)) {
        const disc = found.find((x) => x.id === d.release)!
        const r = this.kept.rows[d.release]
        if (!r) this.kept.rows[d.release] = this.newRow(disc, f.artist_id, f.name, disc.tracks, d.wanted ? 'wanted' : 'skipped', d.reason, 0)
        else if (!r.manual && (r.status === 'wanted' || r.status === 'skipped')) this.touch(r, { status: d.wanted ? 'wanted' : 'skipped', reason: d.reason })
      }
      Object.assign(f, { checked: now(), check_error: null })
    } catch (err: any) {
      Object.assign(f, { checked: now(), check_error: err?.message || String(err) })
    }
    this.save()
    this.pump()
  }
  private async checkAll(follows: FollowRow[]) { for (const f of follows) await this.check(f) }
  /** Those not looked at for a while (once on opening the app, and every hour while it is open). */
  private checkDue() {
    const due = Object.values(this.kept.follows).filter((f) => !f.checked || f.checked * 1000 < Date.now() - CHECK_EVERY_MS)
    if (due.length) this.checkAll(due)
    setTimeout(() => this.checkDue(), H)
  }

  // ---- downloading, one release after another ----
  private waiting(): Row[] {
    return this.rows().filter((r) => r.status === 'wanted').sort((a, b) => (b.manual > 0 ? 1 : 0) - (a.manual > 0 ? 1 : 0) || a.queued - b.queued)
  }
  private async pump() {
    if (this.running || !this.host) return
    this.running = true
    try {
      for (let r = this.waiting()[0]; r; r = this.waiting()[0]) await this.download(r)
    } finally {
      this.running = false
    }
  }

  /** The songs of a release with their tags, where they go. */
  private async songsOf(r: Row): Promise<{ song: PocketSong; track: any }[]> {
    const albumId = r.kind === 'song' ? r.album_id : r.release_id
    const album = albumId ? await this.dz.albumRaw(albumId).catch(() => null) : null
    const all = albumId ? await this.dz.albumTracksRaw(albumId).catch(() => []) : []
    const tracks = r.kind === 'song' ? [all.find((t: any) => t.id === r.track_id) || await this.dz.trackRaw(r.track_id!)] : all
    const albumArtist = album?.artist?.name || r.artist_name || ''
    const albumTitle = album?.title || r.album_title || r.title
    const discs = Math.max(1, ...all.map((t: any) => t.disk_number || 1))
    return tracks.map((t: any) => {
      const n = t.track_position || 0
      const disc = t.disk_number || 1
      return {
        track: t,
        song: {
          artist: t.artist?.name || albumArtist, title: t.title || '', duration: t.duration || 0, isrc: t.isrc || null,
          album: albumTitle, albumArtist, track: n, disc, tracks: album?.nb_tracks || all.length || 0, year: (album?.release_date || r.date || '').slice(0, 4),
          cover: album?.cover_xl || album?.cover_big || r.cover || null,
          folder: `${safe(albumArtist)}/${safe(albumTitle)}`,
          file: `${discs > 1 ? `${disc}-` : ''}${n ? String(n).padStart(2, '0') + ' - ' : ''}${safe(t.title || '')}`
        }
      }
    })
  }

  private async download(r: Row) {
    this.touch(r, { status: 'downloading', progress: { done: 0, total: r.tracks || 0, stage: 'resolving' }, error: null })
    let songs: { song: PocketSong; track: any }[]
    try {
      songs = await this.songsOf(r)
      if (!songs.length) throw new Error('Deezer no da sus canciones')
    } catch (err: any) {
      this.touch(r, { status: 'failed', progress: null, error: err?.message || String(err), attempts: (r.attempts || 0) + 1 })
      return
    }
    const h = this.holdings()
    const files: DeliveredFile[] = []
    let failed = 0
    let lastError = ''
    for (const [i, { song, track }] of songs.entries()) {
      if (this.kept.rows[r.release_id] !== r || r.status !== 'downloading') return   // cancelled
      this.touch(r, { progress: { done: i, total: songs.length, stage: 'downloading', fraction: i / songs.length } })
      const file = { title: song.title, artist: song.artist, track_id: track.id, isrc: song.isrc, duration: song.duration }
      // a song had already (another release, a song on its own) is not downloaded twice
      const had = h.song({ title: song.title, isrc: song.isrc, duration: song.duration, artist_name: song.artist })
      if (had.have === 'done' && had.file) { files.push({ ...file, status: 'done', path: had.file.path }); continue }
      try {
        const got = await this.host!.download(song)
        files.push({ ...file, status: 'done', path: got.path })
      } catch (err: any) {
        failed++
        lastError = err?.message || String(err)
        files.push({ ...file, status: 'failed', path: null })
      }
    }
    if (r.status !== 'downloading') return
    const ok = files.length - failed
    if (!ok) this.touch(r, { status: 'failed', progress: null, files, error: lastError || 'no se pudo bajar', attempts: (r.attempts || 0) + 1, result: { done: 0, review: 0, failed } })
    else this.touch(r, { status: 'done', progress: null, files, error: failed ? `${failed} no se pudieron bajar: ${lastError}` : null, result: { done: ok, review: 0, failed } })
  }
}

/** El Reproductor's API answered in the app itself (see Pocket); `host`: how the app downloads (null: it does not). */
export function pocketApi(open: Fetcher, host: PocketHost | null = null): Api {
  return new Pocket(open, host).api
}
