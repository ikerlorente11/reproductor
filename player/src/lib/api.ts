/** El Reproductor's API (see the service's app.py). Every call carries an Authorization header the
 *  service checks against the cloud: the web session's bearer token, or basic with an app password (the apps). */

export type Mode = 'all' | 'since' | 'new'
export type Kind = 'album' | 'ep' | 'single' | 'compile' | 'live'
export type Status = 'wanted' | 'skipped' | 'downloading' | 'done' | 'failed' | 'preview-wanted' | 'preview-skipped' | 'preview-pending'

export interface Rules {
  mode: Mode
  since_year: number | null
  types: Kind[]
}

export interface Follow extends Rules {
  artist_id: number
  name: string
  picture: string | null
  followed_on: string
  /** epoch seconds of the last look at Deezer; null while a check is due */
  checked: number | null
  check_error: string | null
  counts: Partial<Record<Status, number>>
}

export interface Artist {
  id: number
  name: string
  picture: string | null
  fans: number | null
  albums: number | null
  followed?: boolean
}

export interface DeliveredFile {
  title: string
  artist: string
  status: string
  /** in the personal space; null for a song soundlift could not get */
  path: string | null
  /** the Deezer song it is (to add it to a playlist) */
  track_id?: number | null
  isrc?: string | null
  duration?: number
}

/** How far a download is: songs finished of the total, soundlift's phase, and the fraction done (counting the song under way). */
export interface DownloadProgress {
  done: number
  total: number
  stage?: 'queued' | 'resolving' | 'searching' | 'downloading' | 'finishing' | 'running'
  fraction?: number
}

export interface Release {
  release_id: number
  artist_id: number
  artist_name?: string | null
  title: string
  kind: string
  date: string
  cover: string | null
  tracks: number
  status: Status
  reason: string
  manual?: number
  attempts?: number
  result?: { done: number; review: number; failed: number } | null
  error?: string | null
  files?: DeliveredFile[] | null
  /** a loose song (kind 'song'): its Deezer track and the release it is from */
  track_id?: number | null
  album_id?: number | null
  /** while downloading: songs ready of the total */
  progress?: DownloadProgress | null
  /** epoch seconds of its last change */
  updated?: number
  /** its artist is followed (else it was asked for by hand) */
  followed?: number | boolean
}

export interface Downloads {
  active: Release[]
  waiting: number
  failed: Release[]
  recent: Release[]
}

export interface ReleaseDetail extends Release {
  tracklist: { title: string; duration: number }[]
}

export interface AlbumHit {
  id: number
  title: string
  cover: string | null
  kind: string
  date: string
  artist_id: number | null
  artist_name: string
  tracks: number | null
  /** its status in my library, if any */
  status: Status | null
}

export interface HeldFile {
  path: string
  release_id: number
  title: string
  artist: string
  album: string
  cover: string | null
}

export interface TrackHit {
  id: number
  title: string
  duration: number
  isrc?: string | null
  artist_id: number | null
  artist_name: string
  album_id: number | null
  album_title: string
  cover: string | null
  /** the song on Deezer */
  link?: string | null
  /** what I have of it: downloaded, on its way, or nothing */
  have: 'done' | 'coming' | null
  /** where it plays from, once downloaded */
  file: HeldFile | null
}

/** A song the reorganisation could not place: Deezer did not recognise it (it stays in its old folder). */
export interface Unplaced {
  path: string
  title: string
  artist: string
  album: string
  duration: number
  reason: string
  /** what is searched in Deezer by default */
  query: string
}

export interface AlbumPage {
  id: number
  title: string
  cover: string | null
  kind: string
  date: string
  artist_id: number | null
  artist_name: string
  tracks: number | null
  /** my row of it (downloaded, wanted, skipped…), if any */
  mine: Release | null
  followed: boolean
  songs: TrackHit[]
}

export interface DeezerPlaylistHit {
  id: number
  title: string
  cover: string | null
  tracks: number | null
  owner: string
}

export interface DeezerPlaylistPage extends DeezerPlaylistHit {
  description: string
  songs: TrackHit[]
}

export type ItemKind = 'song' | 'release' | 'artist' | 'file'

export interface PlaylistSummary {
  id: number
  name: string
  created: number
  updated: number
  items: number
  in_navidrome: boolean
  nd_error: string | null
}

export interface PlaylistEntry {
  id: number
  kind: ItemKind
  deezer_id: number
  title: string
  subtitle: string
  cover: string | null
  artist_id: number | null
  release_id: number | null
  /** a file already in the cloud (the songs of the old folder playlists) */
  path?: string | null
  added_on: string
  new_too: boolean
  /** an artist: their releases left out of the playlist */
  skip_releases: number[]
  /** nothing of it is in the cloud yet */
  pending: boolean
}

export interface PlaylistSong {
  key: string
  path: string
  title: string
  artist: string
  album: string
  cover: string | null
  duration: number
  release_id: number
  artist_id: number
  isrc: string | null
  item_id: number
  /** the album it is on, and the Deezer song */
  album_id?: number | null
  track_id?: number | null
}

export interface Playlist extends PlaylistSummary {
  /** songs, releases and artists (the files of an old folder playlist are only in `songs`) */
  entries: PlaylistEntry[]
  file_entries: number
  excluded: { key: string; title: string }[]
  songs: PlaylistSong[]
}

export interface ArtistPage extends Artist {
  follow: Follow | null
  releases: Release[]
}

// ---- moving from Spotify (phase 7): its data download paired with Deezer ----
export type SpotifyStatus = 'found' | 'doubtful' | 'missing' | 'skipped'
export interface SpotifyPick<T> {
  status: SpotifyStatus | null
  score?: number
  /** what it is on Deezer (chosen by El Reproductor or by hand) */
  match: T | null
  candidates: (T & { score?: number })[]
  manual?: boolean
  error?: string
}
export interface SpotifySong extends SpotifyPick<TrackHit> { uri: string; title: string; artist: string; album: string }
export interface SpotifyAlbum extends SpotifyPick<AlbumHit> { uri: string; title: string; artist: string; download: boolean }
export interface SpotifyArtist extends SpotifyPick<Artist> { uri: string; name: string; mode: Mode | 'none'; since_year: number | null }
export interface SpotifyPlaylist { key: string; name: string; kind: 'playlist' | 'liked'; include: boolean; songs: string[] }
export interface SpotifySummary {
  playlists: number
  songs: Partial<Record<SpotifyStatus | 'pending', number>>
  albums: Partial<Record<SpotifyStatus | 'pending', number>>
  artists: Partial<Record<SpotifyStatus | 'pending', number>>
  skipped: { local: number; episodes: number }
  per_playlist: { key: string; name: string; kind: string; include: boolean; total: number; found: number }[]
  artists_bytes: number
  albums_bytes: number
}
export interface SpotifyImport {
  id: number
  status: 'matching' | 'ready' | 'error' | 'applying' | 'applied'
  progress: { done: number; total: number } | null
  error: string | null
  created: number
  updated: number
  summary: SpotifySummary
  free_bytes: number
  album_bytes: number
  /** what the import made, once applied */
  applied: { playlists_created: number; playlists_updated: number; songs_added: number; follows: number; already_followed: number
    albums: number; albums_failed: number; at: number } | null
  data?: { playlists: SpotifyPlaylist[]; songs: Record<string, SpotifySong>; albums: SpotifyAlbum[]; artists: SpotifyArtist[] }
}
export interface SpotifyChoices {
  playlists?: Record<string, { include?: boolean; name?: string }>
  albums?: Record<string, { download?: boolean }>
  artists?: Record<string, { mode?: Mode | 'none'; since_year?: number | null }>
}

export interface Lyrics {
  found: boolean
  /** where they came from: Deezer, Musixmatch or LRCLIB */
  source: string | null
  instrumental: boolean
  /** lines with the second they start at */
  synced: { t: number; text: string }[] | null
  plain: string | null
  /** which song a hand-made shift belongs to, and that shift in seconds (+: later), the same for everyone */
  key: string
  offset: number
}

export type DeviceKind = 'web' | 'desktop' | 'android'
/** What a device plays, as it tells the others (`time` at the moment it told: see DeviceInfo.age). */
export interface RemoteState {
  song: { key: string; title: string; artist: string; album: string; cover: string | null; duration: number } | null
  index: number
  length: number
  playing: boolean
  time: number
  duration: number
  volume: number
  shuffle: boolean
  repeat: boolean
}
export interface DeviceInfo {
  id: string
  name: string
  kind: DeviceKind
  /** the device asking */
  me: boolean
  online: boolean
  state: RemoteState | null
  /** seconds since it told its state */
  age: number
}
export interface DeviceCommand { seq: number; from: string; type: string; data: Record<string, any> }

/** Gives the Authorization header of each call (it may change: a web session renews its token). */
export type Auth = () => string

export class Api {
  /** `mintAppToken`: makes an app password the service keeps to download in the background (the web mints one
   *  in the cloud; an app already logs in with one and hands it over itself). */
  constructor(readonly baseUrl: string, readonly auth: Auth, private mintAppToken?: () => Promise<string>) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  static bearer(token: () => string): Auth { return () => `Bearer ${token()}` }
  static basic(user: string, password: string): Auth {
    const bytes = new TextEncoder().encode(`${user}:${password}`)
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    const header = `Basic ${btoa(bin)}`
    return () => header
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      ...init,
      headers: { Authorization: this.auth(), 'Content-Type': 'application/json', ...((init.headers as any) || {}) }
    })
    if (!res.ok) {
      const detail = await res.json().then((b) => b.detail).catch(() => res.statusText)
      const err: any = new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join('; ') : res.statusText)
      err.status = res.status
      throw err
    }
    return res.json()
  }

  /** Who the service says we are ({connected, username}). */
  cloud() { return this.call<{ connected: boolean; username?: string }>('/api/cloud') }
  /** Hands the service an app password of this user, to download in the background. */
  connectCloud(token: string) { return this.call('/api/cloud/connect', { method: 'POST', body: JSON.stringify({ token }) }) }

  /** Makes sure the service holds an app token of this user: mints one the first time. */
  async ensureConnected(): Promise<void> {
    const status = await this.cloud()
    if (status.connected) return
    if (!this.mintAppToken) throw new Error('el servicio no tiene una contraseña de aplicación tuya')
    await this.connectCloud(await this.mintAppToken())
  }

  search(q: string) { return this.call<Artist[]>(`/api/search?q=${encodeURIComponent(q)}`) }
  /** An artist's most listened songs (Deezer's), each with what I have of it. */
  artistTop(id: number, limit = 10) { return this.call<TrackHit[]>(`/api/artists/${id}/top?limit=${limit}`) }
  /** A song's lyrics (LRCLIB), synced line by line when there are. */
  lyrics(artist: string, title: string, album = '', duration = 0, trackId?: number | null) {
    const q = new URLSearchParams({ artist, title, ...(album ? { album } : {}), ...(duration ? { duration: String(Math.round(duration)) } : {}),
                                    ...(trackId && trackId > 0 ? { track_id: String(trackId) } : {}) })
    return this.call<Lyrics>(`/api/lyrics?${q}`)
  }
  /** Shift a song's synced lyrics for everyone (0: as they came). */
  setLyricsOffset(key: string, source: string, offset: number) {
    return this.call<{ offset: number }>('/api/lyrics/offset', { method: 'PUT', body: JSON.stringify({ key, source, offset }) })
  }
  /** `quick`: the releases at once, without deciding yet what following would download ('preview-pending'). */
  artist(id: number, quick = false) { return this.call<ArtistPage>(`/api/artists/${id}${quick ? '?quick=true' : ''}`) }

  follows() { return this.call<Follow[]>('/api/follows') }
  follow(artistId: number, rules: Rules) {
    return this.call<Follow>('/api/follows', { method: 'POST', body: JSON.stringify({ artist_id: artistId, ...rules }) })
  }
  changeRules(artistId: number, rules: Rules) {
    return this.call<Follow>(`/api/follows/${artistId}`, { method: 'PUT', body: JSON.stringify(rules) })
  }
  unfollow(artistId: number) { return this.call<{ unfollowed: number }>(`/api/follows/${artistId}`, { method: 'DELETE' }) }
  checkNow() { return this.call<{ checking: number }>('/api/follows/check', { method: 'POST' }) }

  searchAlbums(q: string) { return this.call<AlbumHit[]>(`/api/search/albums?q=${encodeURIComponent(q)}`) }
  searchTracks(q: string) { return this.call<TrackHit[]>(`/api/search/tracks?q=${encodeURIComponent(q)}`) }
  searchPlaylists(q: string) { return this.call<DeezerPlaylistHit[]>(`/api/search/playlists?q=${encodeURIComponent(q)}`) }
  album(id: number) { return this.call<AlbumPage>(`/api/albums/${id}`) }
  deezerPlaylist(id: number) { return this.call<DeezerPlaylistPage>(`/api/deezer/playlists/${id}`) }
  downloadDeezerPlaylist(id: number) { return this.call<{ asked: number }>(`/api/deezer/playlists/${id}/download`, { method: 'POST' }) }
  saveDeezerPlaylist(id: number) { return this.call<Playlist>(`/api/deezer/playlists/${id}/save`, { method: 'POST', body: '{}' }) }
  downloadSong(trackId: number) { return this.call<Release>(`/api/songs/${trackId}/download`, { method: 'POST' }) }

  // ---- the user's devices, as Spotify Connect (connect.ts) ----
  devices(me: string) { return this.call<DeviceInfo[]>(`/api/devices?me=${encodeURIComponent(me)}`) }
  putDevice(id: string, body: { name: string; kind: DeviceKind; state: RemoteState | null }) {
    return this.call<DeviceInfo[]>(`/api/devices/${id}`, { method: 'PUT', body: JSON.stringify(body) })
  }
  deviceEvents(id: string, since: number, wait: number) {
    return this.call<{ seq: number; commands: DeviceCommand[]; devices: DeviceInfo[] }>(`/api/devices/${id}/events?since=${since}&wait=${wait}`)
  }
  deviceCommand(target: string, sender: string, type: string, data: Record<string, unknown> = {}) {
    return this.call<{ sent: string }>(`/api/devices/${target}/commands`, { method: 'POST', body: JSON.stringify({ sender, type, data }) })
  }
  /** Leaving (the page closes): the others stop listing it at once. */
  leaveDevice(id: string) {
    fetch(`${this.baseUrl}/api/devices/${id}`, { method: 'DELETE', keepalive: true, headers: { Authorization: this.auth() } }).catch(() => {})
  }

  playlists() { return this.call<PlaylistSummary[]>('/api/playlists') }
  playlist(id: number) { return this.call<Playlist>(`/api/playlists/${id}`) }
  createPlaylist(name: string) { return this.call<Playlist>('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) }) }
  renamePlaylist(id: number, name: string) { return this.call<Playlist>(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }) }
  deletePlaylist(id: number) { return this.call<{ removed: number }>(`/api/playlists/${id}`, { method: 'DELETE' }) }
  /** `skipReleases`: an artist's releases left out; `exclude`: a release's songs left out. */
  addToPlaylist(id: number, kind: ItemKind, deezerId: number,
                { newToo = true, skipReleases = [], exclude = [] }: { newToo?: boolean; skipReleases?: number[]; exclude?: { key: string; title: string }[] } = {}) {
    return this.call<Playlist>(`/api/playlists/${id}/items`, {
      method: 'POST', body: JSON.stringify({ kind, id: deezerId, new_too: newToo, skip_releases: skipReleases, exclude }) })
  }
  removeFromPlaylist(id: number, itemId: number) { return this.call<Playlist>(`/api/playlists/${id}/items/${itemId}`, { method: 'DELETE' }) }
  changeItem(id: number, itemId: number, change: { new_too?: boolean; skip_releases?: number[] }) {
    return this.call<Playlist>(`/api/playlists/${id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(change) })
  }
  reorder(id: number, itemIds: number[]) { return this.call<Playlist>(`/api/playlists/${id}/order`, { method: 'PUT', body: JSON.stringify({ items: itemIds }) }) }
  exclude(id: number, key: string, title: string) {
    return this.call<Playlist>(`/api/playlists/${id}/exclude`, { method: 'POST', body: JSON.stringify({ key, title }) })
  }
  include(id: number, key: string) { return this.call<Playlist>(`/api/playlists/${id}/exclude?key=${encodeURIComponent(key)}`, { method: 'DELETE' }) }

  releases(query: { status?: Status; artist?: number; recent?: boolean; limit?: number; lite?: boolean } = {}) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== false) params.set(k, String(v))
    return this.call<Release[]>(`/api/releases?${params}`)
  }
  release(id: number) { return this.call<ReleaseDetail>(`/api/releases/${id}`) }
  downloads() { return this.call<Downloads>('/api/downloads') }
  /** Deezer's 30-second sample of a song. */
  async preview(trackId: number): Promise<Blob> {
    const res = await fetch(`${this.baseUrl}/api/songs/${trackId}/preview`, { headers: { Authorization: this.auth() } })
    if (!res.ok) throw new Error(res.status === 404 ? 'Deezer no tiene muestra de esta canción' : 'No se pudo cargar la muestra')
    return res.blob()
  }
  unplaced() { return this.call<Unplaced[]>('/api/unplaced') }
  unplacedCandidates(path: string, q?: string) {
    return this.call<TrackHit[]>(`/api/unplaced/candidates?path=${encodeURIComponent(path)}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
  }
  /** Moves it into Artistas as that Deezer song; without one, it stays where it is. */
  place(path: string, trackId: number | null) {
    return this.call<{ path: string; kept: boolean; was_there?: boolean }>('/api/unplaced/place', { method: 'POST', body: JSON.stringify({ path, track_id: trackId }) })
  }
  /** Files deleted from the cloud: out of the releases (one left empty is not downloaded again). */
  forget(paths: string[]) { return this.call<{ releases: number }>('/api/forget', { method: 'POST', body: JSON.stringify({ paths }) }) }
  choose(id: number, choice: 'download' | 'skip' | 'auto' | 'cancel') {
    return this.call<Release>(`/api/releases/${id}/${choice}`, { method: 'POST' })
  }
  spotifyImport(detail = false) { return this.call<{ import: SpotifyImport | null }>(`/api/spotify/import${detail ? '?detail=true' : ''}`) }
  /** The ZIP of Spotify's data download (or one of its JSON files), as it is. */
  spotifyUpload(file: Blob) {
    return this.call<{ import: SpotifyImport }>('/api/spotify/import', { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/zip' } })
  }
  spotifyChoices(choices: SpotifyChoices) {
    return this.call<{ import: SpotifyImport }>('/api/spotify/import/choices', { method: 'PUT', body: JSON.stringify(choices) })
  }
  /** Which Deezer song, album or artist it is (`id`), or that it does not come (null). */
  spotifyMatch(kind: 'song' | 'album' | 'artist', uri: string, id: number | null) {
    return this.call<{ item: SpotifySong | SpotifyAlbum | SpotifyArtist; summary: SpotifySummary }>('/api/spotify/import/match',
      { method: 'PUT', body: JSON.stringify({ kind, uri, id }) })
  }
  /** Brings the reviewed import over, in the background (spotifyImport() says how it goes). */
  spotifyApply() { return this.call<{ import: SpotifyImport }>('/api/spotify/import/apply', { method: 'POST' }) }
  spotifyDiscard() { return this.call<{ removed: number }>('/api/spotify/import', { method: 'DELETE' }) }
}
