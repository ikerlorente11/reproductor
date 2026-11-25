/**
 * Without connection: songs of the cloud kept on the device (an app connected to a server). The host copies them
 * into its music folder with the cloud's own folders, plays the copy when there is one and keeps them when there is
 * no network (they are then the device's music). Albums and playlists are saved from their pages; a playlist can
 * be «kept downloaded»: what is added to it later comes down by itself.
 */
import { reactive } from 'vue'
import type { Api } from './api.ts'
import { playlistSongs } from './library.ts'

export interface OfflineBackend {
  /** which of these cloud paths have a copy on the device */
  have(paths: string[]): Promise<string[]>
  /** copies them (in the background, one after another; `onProgress` says how it goes) */
  get(paths: string[]): Promise<void>
  /** removes the copies (the cloud's songs stay) */
  remove(paths: string[]): Promise<void>
  /** `done` of `total` in the queue; `path`: the copy just made */
  onProgress(fn: (p: { done: number; total: number; path?: string | null; error?: string | null }) => void): () => void
}

const KEPT = 'reproductor.offline.kept'

export class Offline {
  readonly backend: OfflineBackend
  readonly state = reactive({
    have: new Set<string>(),
    /** what is being copied: done of total (0 of 0: nothing) */
    progress: { done: 0, total: 0 },
    /** paths waiting or being copied */
    queued: new Set<string>(),
    /** playlists kept downloaded (their ids) */
    kept: [] as number[],
    error: ''
  })

  constructor(backend: OfflineBackend) {
    this.backend = backend
    try { this.state.kept = JSON.parse(localStorage.getItem(KEPT) || '[]') } catch (_) {}
    backend.onProgress((p) => {
      this.state.progress = { done: p.done, total: p.total }
      if (p.path) { this.state.have.add(p.path); this.state.queued.delete(p.path) }
      if (p.error) this.state.error = p.error
      if (p.done >= p.total) this.state.queued.clear()
    })
  }

  /** Asks which of these songs are on the device (the pages call it with the songs they show). */
  async check(paths: (string | null | undefined)[]): Promise<void> {
    const list = paths.filter((p): p is string => !!p)
    if (!list.length) return
    const got = new Set(await this.backend.have(list))
    for (const p of list) got.has(p) ? this.state.have.add(p) : this.state.have.delete(p)
  }

  has(path: string | null | undefined): boolean { return !!path && this.state.have.has(path) }

  async download(paths: (string | null | undefined)[]): Promise<number> {
    const missing = [...new Set(paths.filter((p): p is string => !!p && !this.state.have.has(p) && !this.state.queued.has(p)))]
    if (!missing.length) return 0
    this.state.error = ''
    missing.forEach((p) => this.state.queued.add(p))
    await this.backend.get(missing)
    return missing.length
  }

  async remove(paths: (string | null | undefined)[]): Promise<void> {
    const list = paths.filter((p): p is string => !!p)
    await this.backend.remove(list)
    list.forEach((p) => this.state.have.delete(p))
  }

  isKept(id: number): boolean { return this.state.kept.includes(id) }
  setKept(id: number, on: boolean) {
    this.state.kept = on ? [...new Set([...this.state.kept, id])] : this.state.kept.filter((k) => k !== id)
    try { localStorage.setItem(KEPT, JSON.stringify(this.state.kept)) } catch (_) {}
  }

  /** The playlists kept downloaded get what they have now and is not on the device yet. */
  async syncKept(api: Api): Promise<void> {
    for (const id of [...this.state.kept]) {
      try {
        const songs = playlistSongs((await api.playlist(id)).songs).map((s) => s.path)
        await this.check(songs)
        await this.download(songs)
      } catch (err: any) {
        if (err?.status === 404) this.setKept(id, false)   // the playlist is gone
      }
    }
  }
}
