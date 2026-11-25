/**
 * The download engine of an app: soundlift and the El Reproductor service running on the device (the desktop app
 * downloads it apart the first time and starts it with the app), so the app is El Reproductor as on the server —
 * search the catalogue, follow artists, download albums and songs — and no server does the work. Each platform
 * gives an `EngineBackend`; `LocalEngine` keeps its state for the pages.
 */
import { reactive } from 'vue'
import type { Fetch } from './api.ts'

/** The engine running: soundlift's port, the El Reproductor service's and the key to call it. */
export interface EngineRunning { port: number; rp_port: number; token: string }

export interface EngineStatus {
  /** the release installed (motor-v…), if any */
  installed: string | null
  /** what it carries: soundlift's and yt-dlp's versions, when it was built */
  info: { soundlift?: string; ytdlp?: string; built?: string } | null
  /** a newer yt-dlp it uses instead of its own */
  ytdlp: string | null
  /** while it runs */
  running: EngineRunning | null
  /** where the music it downloads goes */
  music_dir: string
}

export interface EngineBackend {
  status(): Promise<EngineStatus>
  /** the newest engine published, and how big it is */
  latest(): Promise<{ tag: string; size: number }>
  install(): Promise<string>
  /** looks for a newer yt-dlp (every few days; now with `force`) */
  updateYtdlp(force?: boolean): Promise<string | null>
  /** starts it if needed */
  start(): Promise<EngineRunning>
  /** asks for a folder (none: the default); the folder now used */
  chooseMusicDir(reset?: boolean): Promise<string | null>
  openMusicDir(): Promise<void>
  onProgress(fn: (p: { done: number; total: number }) => void): () => void
  /** how the page reaches it (an app: its own fetch, without the browser's CORS) */
  fetch: Fetch
}

export class LocalEngine {
  readonly backend: EngineBackend
  readonly state = reactive({
    status: null as EngineStatus | null,
    /** the newest published, once asked (to say how big the download is, or that there is a newer one) */
    latest: null as { tag: string; size: number } | null,
    installing: false,
    starting: false,
    progress: { done: 0, total: 0 },
    error: ''
  })

  constructor(backend: EngineBackend) {
    this.backend = backend
    backend.onProgress((p) => { this.state.progress = p })
  }

  async refresh(): Promise<EngineStatus> {
    this.state.status = await this.backend.status()
    return this.state.status
  }

  async findLatest(): Promise<void> {
    try { this.state.latest = await this.backend.latest() } catch (err: any) { this.state.error = err?.message || String(err) }
  }

  get updatable(): boolean {
    const s = this.state.status
    return !!s?.installed && !!this.state.latest && this.state.latest.tag !== s.installed
  }

  async install(): Promise<boolean> {
    this.state.installing = true
    this.state.error = ''
    this.state.progress = { done: 0, total: this.state.latest?.size || 0 }
    try {
      await this.backend.install()
      await this.refresh()
      return true
    } catch (err: any) {
      this.state.error = `No se pudo instalar el motor: ${err?.message || err}`
      return false
    } finally {
      this.state.installing = false
    }
  }

  /** Starts the engine (a newer yt-dlp looked for first, every few days; failing that is no reason not to start). */
  async start(): Promise<EngineRunning> {
    this.state.starting = true
    this.state.error = ''
    try {
      await this.backend.updateYtdlp(false).catch(() => null)
      const running = await this.backend.start()
      await this.refresh()
      return running
    } catch (err: any) {
      this.state.error = `No se pudo arrancar el motor de descargas: ${err?.message || err}`
      throw err
    } finally {
      this.state.starting = false
    }
  }
}

export const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.round(n / 1e6)} MB`)
