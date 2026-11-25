/**
 * Music servers anyone may have, added in Ajustes › Bibliotecas: Subsonic (Navidrome, Airsonic, Gonic, Ampache…) and
 * Jellyfin. Their songs join the device's music (the same pages: albums, artists, folders, search) and play straight
 * from the server — with no El Reproductor server in between. Each library is read whole once (and again on asking),
 * as tracks shaped like the device's, their ids marked with the library's (`r:<library>:<id>`).
 */
import type { Fetch } from './api.ts'
import type { DeviceTrack } from './device.ts'
import { md5 } from './md5.ts'

export type RemoteKind = 'subsonic' | 'jellyfin'
export const REMOTE_KINDS: { value: RemoteKind; label: string; hint: string }[] = [
  { value: 'subsonic', label: 'Subsonic / Navidrome', hint: 'Navidrome, Airsonic, Gonic, Ampache y cualquier servidor compatible con Subsonic' },
  { value: 'jellyfin', label: 'Jellyfin', hint: 'La música de tu servidor Jellyfin' }
]

/** A library as it is kept (the password apart, in the host's secrets). */
export interface RemoteConfig { id: string; kind: RemoteKind; name: string; url: string; username: string }

export interface RemoteSource {
  readonly config: RemoteConfig
  /** checks the address and the account (throws saying why) */
  check(): Promise<void>
  /** every song of the library */
  songs(): Promise<DeviceTrack[]>
  /** a URL the audio element plays (the credentials in it: an <audio> sends no headers) */
  streamUrl(id: string): string
  coverUrl(cover: string): string
}

export const remoteId = (lib: string, id: string) => `r:${lib}:${id}`
/** `r:<library>:<id>` → [library, id] */
export function splitRemote(id: string): [string, string] | null {
  const m = /^r:([^:]+):(.+)$/.exec(id)
  return m ? [m[1], m[2]] : null
}

const clean = (url: string) => url.trim().replace(/\/+$/, '')
const year = (v: unknown) => { const n = Number(String(v ?? '').slice(0, 4)); return n > 0 ? n : 0 }
const when = (v: unknown) => { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? Math.floor(t / 1000) : 0 }

// ---- Subsonic (https://www.subsonic.org/pages/api.jsp, OpenSubsonic) ----
export class SubsonicSource implements RemoteSource {
  readonly config: RemoteConfig
  private password: string
  private fetch: Fetch
  private salt = Math.random().toString(36).slice(2, 10)

  constructor(config: RemoteConfig, password: string, fetch: Fetch) {
    this.config = { ...config, url: clean(config.url) }
    this.password = password
    this.fetch = fetch
  }

  /** u, t (md5 of the password and a salt), s, v, c: no password sent. */
  private auth(): URLSearchParams {
    return new URLSearchParams({ u: this.config.username, t: md5(this.password + this.salt), s: this.salt, v: '1.16.1', c: 'ElReproductor', f: 'json' })
  }
  private url(method: string, params: Record<string, string | number> = {}): string {
    const q = this.auth()
    for (const [k, v] of Object.entries(params)) q.set(k, String(v))
    return `${this.config.url}/rest/${method}?${q}`
  }
  private async call(method: string, params: Record<string, string | number> = {}): Promise<any> {
    let res: Response
    try {
      res = await this.fetch(this.url(method, params))
    } catch (err: any) {
      throw new Error(`no responde ${this.config.url} (${err?.message || err})`)
    }
    const body = await res.json().catch(() => null)
    const answer = body?.['subsonic-response']
    if (!answer) throw new Error(`${this.config.url} no es un servidor Subsonic (HTTP ${res.status})`)
    if (answer.status !== 'ok') {
      const code = answer.error?.code
      throw new Error(code === 40 || code === 41 || code === 44 ? 'el usuario o la contraseña no son correctos' : answer.error?.message || 'error del servidor')
    }
    return answer
  }

  async check(): Promise<void> { await this.call('ping') }

  /** Every song, a page at a time: search3 with an empty query lists them all (Navidrome, Gonic, Airsonic). */
  async songs(): Promise<DeviceTrack[]> {
    const out: DeviceTrack[] = []
    const PAGE = 500
    for (let offset = 0; ; offset += PAGE) {
      const got = await this.call('search3', { query: '', songCount: PAGE, songOffset: offset, artistCount: 0, albumCount: 0 })
      const page: any[] = got.searchResult3?.song || []
      for (const s of page) out.push(this.track(s))
      if (page.length < PAGE) break
    }
    return out
  }

  private track(s: any): DeviceTrack {
    const artist = s.displayArtist || s.artist || ''
    const albumArtist = s.displayAlbumArtist || s.albumArtists?.[0]?.name || ''
    const path = String(s.path || [albumArtist || artist, s.album, `${s.title}.${s.suffix || 'mp3'}`].filter(Boolean).join('/'))
    return {
      id: remoteId(this.config.id, String(s.id)),
      path: `${this.config.name}/${path.replace(/^\/+/, '')}`,
      size: Number(s.size) || 0, mtime: when(s.created), title: s.title || '', artist, album_artist: albumArtist, album: s.album || '',
      track: Number(s.track) || 0, disc: Number(s.discNumber) || 0, year: year(s.year), genre: s.genre || '',
      duration: Number(s.duration) || 0, cover: s.coverArt ? remoteId(this.config.id, String(s.coverArt)) : null, added: when(s.created)
    }
  }

  streamUrl(id: string): string { return this.url('stream', { id }) }
  coverUrl(cover: string): string { return this.url('getCoverArt', { id: cover, size: 400 }) }
}

// ---- Jellyfin (https://api.jellyfin.org) ----
export class JellyfinSource implements RemoteSource {
  readonly config: RemoteConfig
  private password: string
  private fetch: Fetch
  private device: string
  private token = ''
  private userId = ''

  constructor(config: RemoteConfig, password: string, fetch: Fetch, device = 'El Reproductor') {
    this.config = { ...config, url: clean(config.url) }
    this.password = password
    this.fetch = fetch
    this.device = device
  }

  private header(): string {
    const parts = [`Client="El Reproductor"`, `Device="${this.device.replace(/"/g, '')}"`, `DeviceId="elreproductor-${this.config.id}"`, `Version="1"`]
    if (this.token) parts.push(`Token="${this.token}"`)
    return `MediaBrowser ${parts.join(', ')}`
  }
  private async call(path: string, init: RequestInit = {}): Promise<any> {
    let res: Response
    try {
      res = await this.fetch(`${this.config.url}${path}`, { ...init, headers: { Authorization: this.header(), 'Content-Type': 'application/json', ...(init.headers as any || {}) } })
    } catch (err: any) {
      throw new Error(`no responde ${this.config.url} (${err?.message || err})`)
    }
    if (res.status === 401) throw new Error('el usuario o la contraseña no son correctos')
    if (!res.ok) throw new Error(`${this.config.url} respondió ${res.status}`)
    return res.json()
  }
  private async login(): Promise<void> {
    if (this.token) return
    const got = await this.call('/Users/AuthenticateByName', { method: 'POST', body: JSON.stringify({ Username: this.config.username, Pw: this.password }) })
    if (!got?.AccessToken || !got?.User?.Id) throw new Error(`${this.config.url} no es un servidor Jellyfin`)
    this.token = got.AccessToken
    this.userId = got.User.Id
  }

  async check(): Promise<void> { await this.login() }

  async songs(): Promise<DeviceTrack[]> {
    await this.login()
    const out: DeviceTrack[] = []
    const PAGE = 500
    for (let start = 0; ; start += PAGE) {
      const q = new URLSearchParams({ Recursive: 'true', IncludeItemTypes: 'Audio', Fields: 'Path,Genres,DateCreated,MediaSources',
                                      StartIndex: String(start), Limit: String(PAGE), SortBy: 'AlbumArtist,Album,ParentIndexNumber,IndexNumber' })
      const got = await this.call(`/Users/${this.userId}/Items?${q}`)
      const items: any[] = got.Items || []
      for (const it of items) out.push(this.track(it))
      if (items.length < PAGE) break
    }
    return out
  }

  private track(it: any): DeviceTrack {
    const artist = (it.Artists || []).join(', ') || it.AlbumArtist || ''
    const albumArtist = it.AlbumArtist || ''
    const file = String(it.Path || '').split(/[\\/]/).pop() || `${it.Name}.audio`
    const path = [albumArtist || artist, it.Album, file].filter(Boolean).join('/')
    const cover = it.AlbumId && it.AlbumPrimaryImageTag ? it.AlbumId : it.ImageTags?.Primary ? it.Id : null
    return {
      id: remoteId(this.config.id, String(it.Id)), path: `${this.config.name}/${path}`,
      size: Number(it.MediaSources?.[0]?.Size) || 0, mtime: when(it.DateCreated), title: it.Name || '', artist, album_artist: albumArtist,
      album: it.Album || '', track: Number(it.IndexNumber) || 0, disc: Number(it.ParentIndexNumber) || 0, year: Number(it.ProductionYear) || 0,
      genre: (it.Genres || [])[0] || '', duration: (Number(it.RunTimeTicks) || 0) / 1e7,
      cover: cover ? remoteId(this.config.id, String(cover)) : null, added: when(it.DateCreated)
    }
  }

  streamUrl(id: string): string {
    return `${this.config.url}/Audio/${encodeURIComponent(id)}/universal?${new URLSearchParams({ UserId: this.userId, api_key: this.token,
      DeviceId: `elreproductor-${this.config.id}`, Container: 'opus,ogg,mp3,flac,m4a,aac,wav,webm', TranscodingContainer: 'mp3', AudioCodec: 'mp3' })}`
  }
  coverUrl(cover: string): string {
    return `${this.config.url}/Items/${encodeURIComponent(cover)}/Images/Primary?${new URLSearchParams({ maxHeight: '400', api_key: this.token })}`
  }
}

export function makeSource(config: RemoteConfig, password: string, fetch: Fetch, device?: string): RemoteSource {
  return config.kind === 'jellyfin' ? new JellyfinSource(config, password, fetch, device) : new SubsonicSource(config, password, fetch)
}
