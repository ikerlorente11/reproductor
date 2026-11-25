/** soundlift as El Reproductor shows it: its downloads under way and the songs waiting for a decision.
 *  The same API as soundlift's own web, with the Authorization of the El Reproductor API (soundlift trusts the same cloud). */
import { reactive } from 'vue'
import type { Auth, Fetch } from './api.ts'

export interface SlJob {
  id: string
  url: string
  name?: string | null
  status: string
  collection?: string | null
  total: number
  processed: number
  error?: string | null
  cancelling?: boolean
  summary?: { done?: number; review?: number; failed?: number } | null
}

export interface SlReview {
  spotify_id: string
  title: string
  artists: string[]
  album?: string | null
  duration_ms?: number | null
  status: 'review' | 'failed'
  score?: number | null
  failure_reason?: string | null
}

export interface SlCandidate {
  source: string
  external_id: string
  url: string
  title: string
  artists: string[]
  duration_ms: number | null
  album: string | null
  is_official: boolean
  is_lossless: boolean
  score: number
  rejected: boolean
  reasons: string[]
  tried: { outcome: string; detail: string } | null
}

export const ACTIVE = ['queued', 'resolving', 'running']

/** What the sidebar shows without opening the page: how many songs wait for a decision. */
export const soundliftState = reactive({ url: '', review: 0, active: 0, unplaced: 0 })

export class Soundlift {
  /** how requests go out (an app sets its own) */
  fetch: Fetch = (input, init) => globalThis.fetch(input, init)

  /** `discover`: where to find soundlift's address when none is given (the web asks the cloud's config). */
  constructor(url: string, private auth: Auth, private discover?: () => Promise<string>) { soundliftState.url = url.replace(/\/+$/, '') }

  get baseUrl() { return soundliftState.url }
  get enabled() { return !!soundliftState.url }

  /** Without an address of its own, the one the host finds. */
  async findUrl(): Promise<void> {
    if (soundliftState.url || !this.discover) return
    try { soundliftState.url = String(await this.discover() || '').replace(/\/+$/, '') } catch (_) {}
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetch(this.baseUrl + path, {
      ...init,
      headers: { Authorization: this.auth(), 'Content-Type': 'application/json', ...((init.headers as any) || {}) }
    })
    if (!res.ok) {
      const detail = await res.json().then((b) => b.detail).catch(() => res.statusText)
      throw new Error(typeof detail === 'string' ? detail : res.statusText)
    }
    return res.json()
  }

  jobs() { return this.call<SlJob[]>('/api/jobs') }
  async review(): Promise<SlReview[]> {
    const [toReview, failed] = await Promise.all([this.call<SlReview[]>('/api/tracks?status=review'), this.call<SlReview[]>('/api/tracks?status=failed')])
    return [...toReview, ...failed]
  }
  accept(id: string) { return this.call(`/api/tracks/${id}/accept`, { method: 'POST' }) }
  dismiss(id: string) { return this.call(`/api/tracks/${id}/dismiss`, { method: 'POST' }) }
  dismissAll() { return this.call('/api/tracks/dismiss', { method: 'POST' }) }
  dismissFinished() { return this.call('/api/jobs/dismiss', { method: 'POST' }) }
  cancel(jobId: string) { return this.call(`/api/jobs/${jobId}/cancel`, { method: 'POST' }) }
  candidates(id: string) { return this.call<SlCandidate[]>(`/api/tracks/${id}/candidates`) }
  rechoose(id: string, c: SlCandidate) {
    return this.call<{ status: string; detail?: string }>(`/api/tracks/${id}/rechoose`, { method: 'POST', body: JSON.stringify({ source: c.source, external_id: c.external_id }) })
  }
  /** The song as soundlift got it (its staging copy), to listen to before deciding. */
  async audio(id: string): Promise<Blob> {
    const res = await this.fetch(`${this.baseUrl}/api/tracks/${id}/audio`, { headers: { Authorization: this.auth() } })
    if (!res.ok) throw new Error('No se pudo cargar el audio')
    return res.blob()
  }

  /** Refreshes the sidebar's counts; quiet when soundlift is not reachable. */
  async refreshCounts(): Promise<void> {
    await this.findUrl()
    if (!this.enabled) return
    try {
      const [review, jobs] = await Promise.all([this.review(), this.jobs()])
      soundliftState.review = review.length
      soundliftState.active = jobs.filter((j) => ACTIVE.includes(j.status)).length
    } catch (_) {}
  }
}
