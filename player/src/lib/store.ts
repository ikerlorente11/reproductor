/** What every page of the app shares: the API, the followed artists and how to move around. */
import { inject, reactive, type InjectionKey } from 'vue'
import type { Api, Downloads, Follow, PlaylistSummary, Release } from './api.ts'
import type { DeviceLibrary } from './device.ts'
import type { LocalEngine } from './engine.ts'
import type { Offline } from './offline.ts'
import type { Song } from './library.ts'
import type { Soundlift } from './soundlift.ts'
import type { View } from './views.ts'

export { queryFromView, viewFromQuery, type View } from './views.ts'

/** A thing of the library (a list, an artist, a folder) as the sidebar and «Tu biblioteca» show it: it leads to `view`. */
export interface LibraryEntry { key: string; name: string; note?: string; picture?: string | null; view: View; device?: boolean; title?: string }

/** Something the audio element can play, and how to give it back when the song changes. */
export interface Playable { url: string; release?: () => void }

/** What is in a folder of the music (only audio files; paths as the player uses them). */
export interface Listing {
  folders: { path: string; name: string }[]
  files: { path: string; name: string; size: number }[]
}

/**
 * The music's files, as each platform reaches them: the web through the cloud's WebDAV with its session,
 * the apps through their own side. A missing folder or file fails with `status: 404`.
 */
export interface Files {
  list(dir: string): Promise<Listing>
  /** to the cloud's bin; a file already gone counts as removed */
  remove(path: string): Promise<void>
  /** a URL the audio element can play */
  play(song: Song): Promise<Playable>
}

export interface Store {
  /** the El Reproductor service; only the server's pages use it (they show only when `server`) */
  api: Api
  /** connected to a server of El Reproductor (else only the device's music and what is yours on it) */
  server: boolean
  /** the music of this device, when the platform has some (the apps) */
  device: DeviceLibrary | null
  /** an app's own download engine (soundlift on the device), when it has one */
  engine: LocalEngine | null
  /** songs of the cloud kept on the device (an app connected to a server) */
  offline: Offline | null
  musicRoot: string
  /** the cloud's name, as people know it (where deleted songs go, where soundlift delivers) */
  cloudName: string
  /** where the music is, in words: «tu nube» (the web) or «este equipo» (an app with its own engine) */
  where: string
  files: Files
  /** the app's own fetch, which reaches any site (an app's host, the desktop's; null on the web, where the browser does
   *  not let a page ask other sites): the song's info is asked to Deezer with it, without a server */
  openFetch: ((url: string, init?: RequestInit) => Promise<Response>) | null
  /** the library's lists, artists and folders (what the sidebar shows), and whether they have loaded */
  library: { artists: LibraryEntry[]; lists: LibraryEntry[]; folders: LibraryEntry[]; loaded: boolean }
  state: { follows: Follow[]; playlists: PlaylistSummary[]; downloads: Downloads; albums: Release[]; loaded: boolean; connected: boolean; error: string }
  refreshFollows: () => Promise<void>
  refreshPlaylists: () => Promise<void>
  refreshDownloads: () => Promise<void>
  /** moves to a page; `replace`: without a new entry in the history (to keep a search's words, say) */
  go: (view: View, replace?: boolean) => void
  notify: (text: string, error?: boolean) => void
  sl: Soundlift
  /** Deletes songs from the cloud (to its trash bin) after asking; true when something was deleted. */
  remove: (req: RemoveRequest) => Promise<boolean>
}

export interface RemoveRequest {
  title: string
  paths: (string | null | undefined)[]
  detail?: string
  /** an artist to stop following once their music is gone */
  unfollow?: number
}

export const STORE: InjectionKey<Store> = Symbol('reproductor')

export function createState(): Store['state'] {
  return reactive({ follows: [], playlists: [], downloads: { active: [], waiting: 0, failed: [], recent: [] }, albums: [], loaded: false, connected: false, error: '' })
}

export function useStore(): Store {
  const store = inject(STORE)
  if (!store) throw new Error('El Reproductor: store not provided')
  return store
}
