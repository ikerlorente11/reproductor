/** The page's side of the host (modules/reproductor-host, HostServer.kt): the local server the app serves this page
 * from. Everything goes over HTTP on 127.0.0.1 with the token the app put in the URL (`?t=`), kept for the session. */
import type { AudioOutput, DeviceBackend, DeviceTrack, Listing, OfflineBackend, OutputEvents, OutputItem, SleepTimer } from 'reproductor-player'

const TOKEN_KEY = 'reproductor.host.token'
const BASE_KEY = 'reproductor.host.base'
function remembered(key: string, param: string): string {
  const given = new URLSearchParams(window.location.search).get(param)
  if (given !== null) { try { sessionStorage.setItem(key, given) } catch (_) {} return given }
  try { return sessionStorage.getItem(key) || '' } catch (_) { return '' }
}
export const TOKEN: string = remembered(TOKEN_KEY, 't')
/** Where the host is: '' (this page's own origin), or another origin in development, when the page comes from Vite on
 * the PC and the host runs on the phone (`?host=http://127.0.0.1:48143`). */
export const HOST_BASE: string = remembered(BASE_KEY, 'host').replace(/\/+$/, '')

export interface HostInfo {
  version: string
  /** what the person calls this phone (or its model) */
  device: string
  /** the permission to read the music was given */
  library: boolean
  /** the app's music folder (the cloud's songs kept on the phone) */
  music: string
}

/** A URL of the host with the token, absolute (the native player gets it too). */
export function hostUrl(path: string): string {
  return new URL(`${HOST_BASE}${path}${path.includes('?') ? '&' : '?'}t=${TOKEN}`, location.href).href
}

export async function host<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(HOST_BASE + path, { ...init, headers: { 'X-Host-Token': TOKEN, 'Content-Type': 'application/json', ...((init.headers as any) || {}) } })
  if (!res.ok) {
    const detail = await res.json().then((b) => b.detail).catch(() => res.statusText)
    const err: any = new Error(typeof detail === 'string' ? detail : res.statusText)
    err.status = res.status
    throw err
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}
const post = <T>(path: string, body: unknown = {}) => host<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const info = () => host<HostInfo>('/host/info')

/** The app (React Native) listens for these: open-url goes to the browser, permission asks for the music again. */
export function tellApp(message: Record<string, unknown>): void {
  const rn = (window as any).ReactNativeWebView
  if (rn?.postMessage) rn.postMessage(JSON.stringify(message))
}

// ---- what happens on the host, as it happens ----
type Listener = (event: any) => void
const listeners = new Set<Listener>()
const reopened = new Set<() => void>()
let source: EventSource | null = null
/** `onOpen`: the stream (re)connected, so what happened meanwhile may have been missed */
export function onHostEvent(listener: Listener, onOpen?: () => void): () => void {
  listeners.add(listener)
  if (onOpen) reopened.add(onOpen)
  if (!source) openEvents()
  return () => { listeners.delete(listener); if (onOpen) reopened.delete(onOpen) }
}
function openEvents() {
  source?.close()
  const es = new EventSource(hostUrl('/host/events'))
  source = es
  es.onmessage = (e) => {
    let data: any
    try { data = JSON.parse(e.data) } catch (_) { return }
    for (const l of listeners) l(data)
  }
  es.onopen = () => { for (const f of reopened) f() }
  // the browser gives up for good on some errors (an answer that is not a stream): try again ourselves
  es.onerror = () => { if (es.readyState === EventSource.CLOSED && source === es) setTimeout(() => { if (source === es) openEvents() }, 2000) }
}
/** The stream looks alive but says nothing (it can stall while the web view is held back): a new one. */
export function reopenHostEvents(): void { if (source) openEvents() }

// ---- the page's settings and secrets, kept by the app ----
export const prefs = {
  all: () => host<Record<string, string>>('/host/prefs'),
  set: (values: Record<string, string | null>) => host<Record<string, string>>('/host/prefs', { method: 'PUT', body: JSON.stringify(values) })
}
export const secrets = {
  get: (key: string) => host<{ value: string | null }>(`/host/secret?key=${encodeURIComponent(key)}`).then((r) => r?.value ?? null),
  set: async (key: string, value: string) => { await host<void>(`/host/secret?key=${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) }) },
  delete: async (key: string) => { await host<void>(`/host/secret?key=${encodeURIComponent(key)}`, { method: 'DELETE' }) }
}

// ---- any server, reached through the host: no CORS ----
/** A header value carries only Latin-1: the JSON of the headers goes with everything else escaped (\uXXXX). */
function headerJson(headers: Record<string, string>): string {
  return JSON.stringify(headers).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

/** `fetch` as the page's code uses it (the service, soundlift, Subsonic, LRCLIB…), made by the host: the server's own
 * answer comes back (status, type, body); when it cannot be reached it rejects, like the browser's. */
export const hostFetch: typeof fetch = async (input, init: RequestInit = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const given: Record<string, string> = {}
  new Headers(init.headers || (input instanceof Request ? input.headers : undefined)).forEach((v, k) => { given[k] = v })
  const headers: Record<string, string> = { 'X-Host-Token': TOKEN, 'X-Fetch-Headers': headerJson(given) }
  if (init.body !== undefined && init.body !== null) headers['Content-Type'] = given['content-type'] || 'text/plain;charset=UTF-8'
  const res = await fetch(`${HOST_BASE}/host/fetch?url=${encodeURIComponent(new URL(url, location.href).href)}`, {
    method: (init.method || 'GET').toUpperCase(), headers, body: init.body, signal: init.signal
  })
  const final = res.headers.get('X-Fetch-Url')
  if (!final) {     // the host's own answer, not the server's: the address was refused or not reached
    const detail = await res.json().then((b) => b.detail).catch(() => null)
    throw new TypeError(typeof detail === 'string' ? detail : `No se pudo pedir ${url} (${res.status})`)
  }
  try { Object.defineProperty(res, 'url', { value: final }) } catch (_) {}
  return res
}

// ---- this phone's music (Android's media index, read by the host) ----
export function androidDevice(): DeviceBackend {
  return {
    get: () => host<{ roots: string[]; tracks: DeviceTrack[]; scanning: boolean }>('/host/library'),
    scan: () => post<void>('/host/library/scan'),
    // there is no folder to choose (Android's index has all the music): the folders left out come back
    addRoot: async () => (await post<{ shown: boolean }>('/host/library/show')).shown,
    removeRoot: (path) => post<void>('/host/library/hide', { path }),
    async lyrics(id) {
      const res = await fetch(hostUrl(`/l/${encodeURIComponent(id)}`))
      return res.ok ? res.text() : null
    },
    fileUrl: (id) => hostUrl(`/f/${encodeURIComponent(id)}`),
    coverUrl: (cover) => hostUrl(`/c/${encodeURIComponent(cover)}`),
    onProgress: (fn) => onHostEvent((e) => { if (e.type === 'library-progress') fn({ done: e.done, total: e.total }) }),
    onChanged: (fn) => onHostEvent((e) => { if (e.type === 'library-changed') fn(e.error ?? null) })
  }
}

/** A song another app opened with El Reproductor, as a track (of the library, or one apart). */
export const openUri = (uri: string) => post<DeviceTrack>('/host/library/open', { uri })

// ---- the cloud of the server connected ----
export const cloud = {
  set: (c: { webdav: string; user: string; password: string } | null) =>
    c ? host<void>('/host/cloud', { method: 'PUT', body: JSON.stringify(c) }) : host<void>('/host/cloud', { method: 'DELETE' }),
  list: (dir: string) => post<Listing>('/host/cloud/list', { dir }),
  remove: (path: string) => post<void>('/host/cloud/remove', { path }),
  /** where a song of the cloud plays from (its copy on the phone when there is one) */
  url: (path: string) => hostUrl('/w' + path.split('/').map(encodeURIComponent).join('/'))
}

export function androidOffline(): OfflineBackend {
  return {
    have: (paths) => post<string[]>('/host/offline/have', { paths }),
    get: (paths) => post<void>('/host/offline/get', { paths }),
    remove: (paths) => post<void>('/host/offline/remove', { paths }),
    onProgress: (fn) => onHostEvent((e) => { if (e.type === 'offline-progress') fn(e) })
  }
}

// ---- the sound: Android's player (it goes on with the screen off; see Playback.kt) ----
/** An absolute URL; a host's one with this run's token (the queue kept from an earlier run brings the old one, which the
 * host refuses: the system showed those songs without their cover). */
function current(url: string): string {
  const u = new URL(url, location.href)
  const host = new URL(hostUrl('/'))
  if (u.origin === host.origin && u.searchParams.has('t')) u.searchParams.set('t', TOKEN)
  return u.href
}

export function nativeOutput(): AudioOutput {
  let paused = true
  let time = 0
  let loaded = false
  let on: OutputEvents | null = null
  /** what the app's player knows how to do (an older app, with a newer page from an update, says nothing) */
  let features: string[] = []
  /** the speed, the equaliser and the extra volume asked (sent once the app's player says it can) */
  let rate = 1
  let eqBands: number[] | null = null
  let boost = 0
  const cmd = (body: Record<string, unknown>) =>
    post<{ loaded: boolean; key?: string | null; t?: number; d?: number; playing?: boolean; ended?: boolean
           saved?: { key: string; t: number; at: number } | null; features?: string[]; sleeping?: boolean
           output?: { key: string; name: string } }>('/host/audio', body)
  const absolute = (it: OutputItem): OutputItem => ({ ...it, url: it.url ? current(it.url) : '', cover: it.cover ? current(it.cover) : null })
  /** What the player did while this page slept (or before it was loaded again): its song, its second, whether it plays. */
  async function resync() {
    if (!on) return
    try {
      const s = await cmd({ op: 'state' })
      const could = new Set(features)
      features = s.features || []
      const now = (f: string) => !could.has(f) && features.includes(f)
      if (now('rate') && rate !== 1) cmd({ op: 'rate', r: rate }).catch(() => {})
      if (now('eq') && eqBands) cmd({ op: 'eq', bands: eqBands }).catch(() => {})
      if (now('boost') && boost) cmd({ op: 'boost', db: boost }).catch(() => {})
      if (s.output?.key) on.output?.(s.output.key, s.output.name)
      // the sleep timer went off while this page slept
      if (s.sleeping === false) on.slept?.()
      // the app was closed: where the player was kept (it went on while this page slept)
      if (!s.loaded) { if (s.saved) on.resumed?.(s.saved.key, s.saved.t, s.saved.at); return }
      loaded = true
      if (s.key) on.moved?.(s.key)
      if (s.d) on.duration(s.d)
      if (typeof s.t === 'number') { time = s.t; on.time(s.t) }
      if (s.playing && paused) { paused = false; on.play() } else if (!s.playing && !paused) { paused = true; on.pause() }
    } catch (_) {}
  }
  /** when the player last said something: while it plays it tells the second twice a second */
  let heard = Date.now()
  setInterval(() => {
    if (paused || document.hidden || Date.now() - heard < 3000) return
    // playing, on screen and silent: the events stopped coming (the bar froze until the screen went off and on)
    heard = Date.now()
    resync()
    reopenHostEvents()
  }, 1000)
  onHostEvent((e) => {
    if (e.type !== 'audio' || !on) return
    heard = Date.now()
    switch (e.ev) {
      case 'time': time = e.t; on.time(e.t); break
      case 'duration': on.duration(e.d); break
      // (it may have been started from the widget, with nothing loaded from here)
      case 'play': loaded = true; if (paused) { paused = false; on.play() } break
      case 'pause': if (typeof e.t === 'number') time = e.t; if (!paused) { paused = true; on.pause() } break
      case 'ended': paused = true; on.ended(); break
      case 'moved': loaded = true; on.moved?.(e.key); break
      case 'slept': on.slept?.(); break
      case 'output': on.output?.(e.key, e.name); break
      case 'error': on.error?.(e.message); break
    }
  }, resync)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync() })
  return {
    continuous: true,
    async load(items, index, from) {
      loaded = true
      time = from
      await cmd({ op: 'load', items: items.map(absolute), index, from })
    },
    window(items, index) { cmd({ op: 'window', items: items.map(absolute), index }).catch(() => {}) },
    async play() { await cmd({ op: 'play' }) },
    pause() { cmd({ op: 'pause' }).catch(() => {}) },
    seek(t) { time = t; cmd({ op: 'seek', t }).catch(() => {}) },
    setVolume(v) { cmd({ op: 'volume', v }).catch(() => {}) },
    setRate(r) { rate = r; if (features.includes('rate')) cmd({ op: 'rate', r }).catch(() => {}) },
    setEq(bands) { eqBands = bands; if (features.includes('eq')) cmd({ op: 'eq', bands }).catch(() => {}) },
    setBoost(db) { boost = db; if (features.includes('boost')) cmd({ op: 'boost', db }).catch(() => {}) },
    // the timer goes in the app's player, which plays on while this page sleeps (without it, the page's own timer)
    get sleep() {
      return features.includes('sleep') ? (timer: SleepTimer | null) => { cmd({ op: 'sleep', ...(timer || {}) }).catch(() => {}) } : undefined
    },
    clear() { loaded = false; paused = true; cmd({ op: 'clear' }).catch(() => {}) },
    get paused() { return paused },
    get currentTime() { return time },
    get loaded() { return loaded },
    listen(events) { on = events; resync() }
  }
}
