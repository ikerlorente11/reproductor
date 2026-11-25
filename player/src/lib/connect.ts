/**
 * The user's devices, as Spotify Connect: every device where El Reproductor is open (the web, the desktop app, the
 * phone) tells the service what it plays and waits for orders (a long poll). From any of them you can hand the
 * playback to another (it goes on there, from the same second; here it stops), bring another's here, or control
 * another from afar (the player bar then shows and drives that one). It is optional: each device keeps its own
 * playback unless asked. Songs only on one device (not in the cloud) do not travel.
 */
import { computed, reactive, watch } from 'vue'
import type { Api, DeviceCommand, DeviceInfo, DeviceKind, RemoteState } from './api.ts'
import {
  currentSession, jump, next, nowPlaying, pause, player, prev, resume, seekTo, setVolume, startSession, toggle, toggleRepeat,
  toggleShuffle, type Session
} from './player.ts'

export interface Me { id: string; name: string; kind: DeviceKind }

export const connect = reactive({
  on: false,
  me: null as Me | null,
  devices: [] as (DeviceInfo & { at: number })[],
  /** the device the player bar drives now ('' : this one) */
  controlling: '',
  /** moves every half second while a far device plays (its time goes on) */
  tick: 0
})

let api: Api | null = null
let seq = -1
let generation = 0
let notice: (text: string, error?: boolean) => void = () => {}

/** This device's id: made once and kept for good (the web: one per browser, whatever its tabs; see `oneTab`). */
export function deviceId(store: Storage = localStorage, key = 'reproductor.device'): string {
  try {
    const known = store.getItem(key)
    if (known && /^[A-Za-z0-9_-]{8,64}$/.test(known)) return known
    const made = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')
    store.setItem(key, made)
    return made
  } catch (_) {
    return `tmp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  }
}

/** "Web · Chrome en Windows" (the web's name among the devices). */
export function browserName(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''
  return `Web · ${os ? `${browser} en ${os}` : browser}`
}

// ---- what this device plays, told to the others ----
function myState(): RemoteState | null {
  const s = nowPlaying.value
  if (!s) return null
  return {
    song: { key: s.key, title: s.title, artist: s.artist, album: s.album, cover: s.cover, duration: s.duration },
    index: player.index, length: player.queue.length, playing: player.playing, time: Math.floor(player.time),
    duration: player.duration, volume: player.volume, shuffle: player.shuffle, repeat: player.repeat
  }
}
let told = ''
let tellTimer: any = null
function tell(soon = 400) {
  clearTimeout(tellTimer)
  tellTimer = setTimeout(async () => {
    if (!api || !connect.me) return
    const body = { name: connect.me.name, kind: connect.me.kind, state: myState() }
    const text = JSON.stringify(body)
    if (text === told) return
    try {
      setDevices(await api.putDevice(connect.me.id, body))
      told = text
    } catch (_) { /* told on the next change */ }
  }, soon)
}

function setDevices(list: DeviceInfo[]) {
  const now = performance.now()
  connect.devices = list.map((d) => ({ ...d, at: now - d.age * 1000 }))
  if (connect.controlling && !list.some((d) => d.id === connect.controlling)) {
    notice('El otro dispositivo se ha desconectado: vuelves a controlar este.')
    connect.controlling = ''
  }
}

// ---- orders from another device ----
const nameOf = (id: string) => connect.devices.find((d) => d.id === id)?.name || 'otro dispositivo'
function obey(c: DeviceCommand) {
  const d = c.data || {}
  switch (c.type) {
    case 'transfer': receive(c); break
    case 'failed':
      // the device this one handed its playback to could not make it sound: it goes on here, where it was
      if (connect.controlling === c.from) connect.controlling = ''
      if (nowPlaying.value) resume()
      notice(`${nameOf(c.from)} no pudo empezar a sonar${d.why ? ` (${d.why})` : ''}. Sigue aquí.`, true)
      break
    case 'handoff': if (d.to) transferTo(String(d.to), false).catch(() => {}); break
    case 'play': resume(); break
    case 'pause': pause(); break
    case 'toggle': toggle(); break
    case 'next': next(); break
    case 'prev': prev(); break
    case 'jump': if (typeof d.index === 'number') jump(d.index); break
    case 'seek': if (typeof d.time === 'number' && player.duration) seekTo(d.time / player.duration); break
    case 'volume': if (typeof d.value === 'number') setVolume(Math.max(0, Math.min(1, d.value))); break
    case 'shuffle': toggleShuffle(); break
    case 'repeat': toggleRepeat(); break
  }
}

/** A playback handed to this device: it sounds here, or the sender is told why not (and keeps it). */
async function receive(c: DeviceCommand) {
  const d = c.data || {}
  connect.controlling = ''
  const ok = await startSession(d.session as Session, d.play !== false)
  if (ok || d.play === false) { notice(`Sonando aquí, desde ${nameOf(c.from)}.`); return }
  const why = player.error.replace(/^No se pudo reproducir «[^»]*»: /, '') || 'no arrancó'
  notice(`No se pudo empezar a sonar lo que llegó de ${nameOf(c.from)}: ${why}`, true)
  send(c.from, 'failed', { why }).catch(() => {})
}

async function listen(mine: number) {
  while (mine === generation && api && connect.me) {
    try {
      const got = await api.deviceEvents(connect.me.id, seq, seq < 0 ? 0 : 25)
      if (mine !== generation) return
      const first = seq < 0
      seq = got.seq
      setDevices(got.devices)
      if (!first) got.commands.forEach(obey)
    } catch (_) {
      await new Promise((r) => setTimeout(r, 5000))   // the service is not there: try again in a while
    }
  }
}

let stopWatch: (() => void) | null = null
let ticker: any = null
let beat: any = null
let releaseTab: (() => void) | null = null
/**
 * Joins the user's devices (once connected to the service). `say`: how the app shows a word to the user.
 * `oneTab` (the web): the browser is one device however many tabs it has open; only one of them stands for it (the
 * first, holding a lock of the browser's), and when it closes the next one takes over. The others play on their own.
 */
export function startConnect(withApi: Api, me: Me, say?: (text: string, error?: boolean) => void, oneTab = false) {
  stopConnect()
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : null
  if (oneTab && locks) {
    const mine = generation
    locks.request(`reproductor.device.${me.id}`, () => new Promise<void>((release) => {
      if (mine !== generation) return release()   // stopped while it waited for its turn
      join(withApi, me, say)
      releaseTab = release
    })).catch(() => {})
    return
  }
  join(withApi, me, say)
}
function join(withApi: Api, me: Me, say?: (text: string, error?: boolean) => void) {
  api = withApi
  connect.me = me
  connect.on = true
  if (say) notice = say
  seq = -1
  told = ''
  const mine = ++generation
  tell(0)
  listen(mine)
  // what it plays changes: the others know at once; while playing, now and then (its second goes on)
  stopWatch = watch(() => [nowPlaying.value?.key, player.playing, player.index, player.queue.length, player.volume, player.shuffle, player.repeat,
                          Math.round(player.duration)], () => tell())
  let lastTime = 0
  const offSeek = watch(() => player.time, (t) => { if (Math.abs(t - lastTime) > 3) tell(); lastTime = t })
  const offWatch = stopWatch
  stopWatch = () => { offWatch(); offSeek() }
  beat = setInterval(() => { if (player.playing) { told = ''; tell(0) } }, 15000)
  ticker = setInterval(() => { if (connect.controlling) connect.tick++ }, 500)
  if (typeof window !== 'undefined') window.addEventListener('pagehide', leave)
}
function leave() { if (api && connect.me) api.leaveDevice(connect.me.id) }
export function stopConnect() {
  generation++
  releaseTab?.()
  releaseTab = null
  stopWatch?.()
  stopWatch = null
  clearInterval(ticker)
  clearInterval(beat)
  clearTimeout(tellTimer)
  if (typeof window !== 'undefined') window.removeEventListener('pagehide', leave)
  connect.on = false
  connect.controlling = ''
  connect.devices = []
}

// ---- what the user does with the others ----
export const others = computed(() => connect.devices.filter((d) => !d.me && d.online))
export const controlled = computed(() => connect.devices.find((d) => d.id === connect.controlling) || null)

/** The controlled device's state now: its second moved on by the time since it told it. */
export const remote = computed<RemoteState | null>(() => {
  void connect.tick
  const d = controlled.value
  if (!d?.state) return null
  const s = d.state
  const time = s.playing ? Math.min(s.duration || Infinity, s.time + (performance.now() - d.at) / 1000) : s.time
  return { ...s, time }
})

async function send(target: string, type: string, data: Record<string, unknown> = {}) {
  if (!api || !connect.me) return
  try {
    await api.deviceCommand(target, connect.me.id, type, data)
  } catch (err: any) {
    notice(err?.status === 404 ? 'Ese dispositivo ya no está conectado.' : `No se pudo: ${err?.message || err}`, true)
    throw err
  }
}

/** Hands this playback to another device: it goes on there from the same second; here it stops and (`drive`) the bar
 *  drives that one. */
export async function transferTo(target: string, drive = true) {
  const s = currentSession()
  if (!s) { notice('No suena nada aquí que pasar.', true); return }
  const current = s.queue[s.index]
  const queue = s.queue.filter((x) => !(x as { device?: string }).device)   // songs only on this device do not travel
  const lost = s.queue.length - queue.length
  let index = queue.findIndex((x) => x.key === current.key)
  const time = index >= 0 ? s.time : 0
  if (index < 0) {   // the song playing is only here: from the next one that travels
    const after = queue.findIndex((x) => s.queue.indexOf(x) > s.index)
    index = after >= 0 ? after : 0
  }
  if (!queue.length) { notice('Lo que suena está solo en este dispositivo: no se puede pasar.', true); return }
  await send(target, 'transfer', { session: { ...s, queue, index, time }, play: true })
  pause()
  if (drive) connect.controlling = target
  if (lost) notice(`${lost} ${lost === 1 ? 'canción de este dispositivo no pasa' : 'canciones de este dispositivo no pasan'}: no están en tu nube.`)
}
/** Brings another device's playback here (it stops there). */
export async function bringHere(source: string) {
  if (!connect.me) return
  await send(source, 'handoff', { to: connect.me.id })
  connect.controlling = ''
}
/** The player bar drives another device (its playback goes on there); '' : this one again. */
export function controlDevice(id: string) { connect.controlling = id }

/** The player bar's controls, on this device or the one controlled. */
export const control = {
  toggle: () => (connect.controlling ? send(connect.controlling, 'toggle').catch(() => {}) : toggle()),
  next: () => (connect.controlling ? send(connect.controlling, 'next').catch(() => {}) : next()),
  prev: () => (connect.controlling ? send(connect.controlling, 'prev').catch(() => {}) : prev()),
  shuffle: () => (connect.controlling ? send(connect.controlling, 'shuffle').catch(() => {}) : toggleShuffle()),
  repeat: () => (connect.controlling ? send(connect.controlling, 'repeat').catch(() => {}) : toggleRepeat()),
  seek: (fraction: number) => {
    const r = remote.value
    if (connect.controlling && r) send(connect.controlling, 'seek', { time: fraction * (r.duration || 0) }).catch(() => {})
    else seekTo(fraction)
  },
  volume: (v: number) => {
    if (!connect.controlling) return setVolume(v)
    clearTimeout(volumeTimer)   // a slider moved sends one order when it rests, not one per step
    volumeTimer = setTimeout(() => send(connect.controlling, 'volume', { value: v }).catch(() => {}), 250)
  }
}
let volumeTimer: any = null
