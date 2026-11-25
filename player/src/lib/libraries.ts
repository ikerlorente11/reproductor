/**
 * The music servers added by the user (Subsonic, Jellyfin): which they are (kept on the device; the passwords in the
 * host's secrets), read whole, and joined to the device's own music by `withRemotes`: one backend for the pages, where
 * each library is one more folder of the music (its name).
 */
import { reactive } from 'vue'
import type { Fetch } from './api.ts'
import type { DeviceBackend, DeviceTrack } from './device.ts'
import { makeSource, splitRemote, type RemoteConfig, type RemoteSource } from './remote.ts'

const LIST = 'reproductor.libraries'

/** Where a platform keeps secrets (Windows' Credential Manager on the desktop). */
export interface Secrets {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export class RemoteLibraries {
  readonly state = reactive({
    list: [] as RemoteConfig[],
    /** libraries being read now */
    loading: [] as string[],
    errors: {} as Record<string, string>,
    /** songs of each library, once read */
    counts: {} as Record<string, number>
  })
  private sources = new Map<string, RemoteSource>()
  private tracks = new Map<string, DeviceTrack[]>()
  private listeners = new Set<() => void>()

  private secrets: Secrets
  private fetch: Fetch
  private device: string

  constructor(secrets: Secrets, fetch: Fetch, device = 'El Reproductor') {
    this.secrets = secrets
    this.fetch = fetch
    this.device = device
    try { this.state.list = JSON.parse(localStorage.getItem(LIST) || '[]') } catch (_) {}
  }

  private save() { try { localStorage.setItem(LIST, JSON.stringify(this.state.list)) } catch (_) {} }
  private changed() { for (const fn of this.listeners) fn() }
  onChanged(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }

  /** Reads every library saved (the app starting). */
  async start(): Promise<void> { await Promise.all(this.state.list.map((c) => this.load(c.id))) }

  private async source(c: RemoteConfig): Promise<RemoteSource> {
    let s = this.sources.get(c.id)
    if (!s) {
      const password = (await this.secrets.get(`library:${c.id}`)) || ''
      s = makeSource(c, password, this.fetch, this.device)
      this.sources.set(c.id, s)
    }
    return s
  }

  /** Reads a library again (all its songs). */
  async load(id: string): Promise<void> {
    const c = this.state.list.find((x) => x.id === id)
    if (!c || this.state.loading.includes(id)) return
    this.state.loading.push(id)
    try {
      const songs = await (await this.source(c)).songs()
      this.tracks.set(id, songs)
      this.state.counts[id] = songs.length
      delete this.state.errors[id]
    } catch (err: any) {
      this.state.errors[id] = err?.message || String(err)
    } finally {
      this.state.loading = this.state.loading.filter((x) => x !== id)
      this.changed()
    }
  }

  /** Adds a library, after checking its address and account; its name must not be that of another one. */
  async add(input: Omit<RemoteConfig, 'id'>, password: string): Promise<RemoteConfig> {
    const name = input.name.trim() || new URL(input.url.trim()).host
    if (this.state.list.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`ya hay una biblioteca llamada «${name}»`)
    const config: RemoteConfig = { ...input, name, url: input.url.trim().replace(/\/+$/, ''), id: Date.now().toString(36) }
    const source = makeSource(config, password, this.fetch, this.device)
    await source.check()
    await this.secrets.set(`library:${config.id}`, password)
    this.sources.set(config.id, source)
    this.state.list.push(config)
    this.save()
    this.load(config.id)
    return config
  }

  async remove(id: string): Promise<void> {
    this.state.list = this.state.list.filter((c) => c.id !== id)
    this.save()
    this.sources.delete(id)
    this.tracks.delete(id)
    delete this.state.counts[id]
    delete this.state.errors[id]
    await this.secrets.delete(`library:${id}`).catch(() => {})
    this.changed()
  }

  byName(name: string): RemoteConfig | undefined { return this.state.list.find((c) => c.name === name) }
  allTracks(): DeviceTrack[] { return this.state.list.flatMap((c) => this.tracks.get(c.id) || []) }

  /** A remote song's or cover's URL (null: not of a library). */
  url(id: string, cover = false): string | null {
    const parts = splitRemote(id)
    const s = parts && this.sources.get(parts[0])
    if (!parts || !s) return null
    return cover ? s.coverUrl(parts[1]) : s.streamUrl(parts[1])
  }
}

/** The device's music and the libraries' as one backend: each library is one more folder (its name). */
export function withRemotes(local: DeviceBackend, remotes: RemoteLibraries): DeviceBackend {
  const isRemote = (path: string) => !!remotes.byName(path.split('/')[0])
  return {
    async get() {
      const got = await local.get()
      return { ...got, roots: [...got.roots, ...remotes.state.list.map((c) => c.name)], tracks: [...got.tracks, ...remotes.allTracks()] }
    },
    async scan() {
      await local.scan()
      remotes.state.list.forEach((c) => remotes.load(c.id))
    },
    addRoot: () => local.addRoot(),
    async removeRoot(path) {
      const lib = remotes.byName(path)
      if (lib) await remotes.remove(lib.id)
      else await local.removeRoot(path)
    },
    reveal: local.reveal ? (path) => (isRemote(path) ? Promise.resolve() : local.reveal!(path)) : undefined,
    lyrics: local.lyrics ? (id) => (splitRemote(id) ? Promise.resolve(null) : local.lyrics!(id)) : undefined,
    fileUrl: (id) => remotes.url(id) ?? local.fileUrl(id),
    coverUrl: (cover) => remotes.url(cover, true) ?? local.coverUrl(cover),
    onProgress: (fn) => local.onProgress(fn),
    onChanged(fn) {
      const a = local.onChanged(fn)
      const b = remotes.onChanged(() => fn(null))
      return () => { a(); b() }
    }
  }
}
