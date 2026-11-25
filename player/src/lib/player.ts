/**
 * The player: one audio output and its queue for the whole app, kept outside the components so
 * moving between pages never cuts the music. The app tells it how to turn a cloud path into
 * something the output can play (`setResolver`). The output is the browser's <audio> unless the app gives
 * its own (`setOutput`): Android's goes on with the screen off, where the page's JavaScript sleeps, so it gets a
 * window of the queue and moves through it by itself, telling the page which song it is on.
 */
import { computed, reactive, watch } from 'vue'
import { queueFrom, shuffled, type Song } from './library.ts'
import { recordPlay } from './mine.ts'

type Resolved = { url: string; release?: () => void }

/** A song as an output gets it: where it plays from and what the system shows of it (notification, lock screen). */
export interface OutputItem { key: string; url: string; title: string; artist: string; album: string; cover: string | null; duration: number }

/** What an output tells the player. */
export interface OutputEvents {
  time(seconds: number): void
  duration(seconds: number): void
  play(): void
  pause(): void
  /** the song (the last of its window, for a continuous output) came to its end */
  ended(): void
  /** a continuous output went by itself (or from the notification) to another song of its window */
  moved?(key: string): void
  error?(message: string): void
}

/** What makes the sound. */
export interface AudioOutput {
  /** goes through the songs by itself: it gets a window of the queue around the current song (`load`, `window`) */
  readonly continuous?: boolean
  /** loads `items[index]` (with the songs around it, for a continuous output) and plays it from `from` seconds */
  load(items: OutputItem[], index: number, from: number): Promise<void>
  /** the songs around the current one changed (the queue was edited, or it moved on): the current one goes on */
  window?(items: OutputItem[], index: number): void
  play(): Promise<void>
  pause(): void
  seek(seconds: number): void
  setVolume(volume: number): void
  /** silence, and forget the song */
  clear(): void
  readonly paused: boolean
  readonly currentTime: number
  /** a song is loaded */
  readonly loaded: boolean
  listen(events: OutputEvents): void
}

/** The browser's <audio>: one song at a time (the page says which comes next). */
export function htmlOutput(): AudioOutput {
  const a = new Audio()
  let at = 0
  return {
    async load(items, index, from) {
      const seq = ++at
      a.src = items[index].url
      if (from) a.addEventListener('loadedmetadata', () => { if (seq === at) a.currentTime = from }, { once: true })
      await a.play()
    },
    play: () => a.play(),
    pause: () => a.pause(),
    seek: (t) => { a.currentTime = t },
    setVolume: (v) => { a.volume = v },
    clear() { at++; a.pause(); a.removeAttribute('src'); a.load() },
    get paused() { return a.paused },
    get currentTime() { return a.currentTime },
    get loaded() { return !!a.getAttribute('src') },
    listen(on) {
      a.addEventListener('timeupdate', () => on.time(a.currentTime))
      a.addEventListener('durationchange', () => on.duration(isFinite(a.duration) ? a.duration : 0))
      a.addEventListener('play', () => on.play())
      a.addEventListener('pause', () => on.pause())
      a.addEventListener('ended', () => on.ended())
    }
  }
}

const state = reactive({
  queue: [] as Song[],
  index: -1,
  playing: false,
  loading: false,
  shuffle: false,
  repeat: false,
  time: 0,
  duration: 0,
  volume: 1,
  error: ''
})
try { state.volume = Number(localStorage.getItem('reproductor.volume') ?? 1) } catch (_) {}
try { state.repeat = localStorage.getItem('reproductor.repeat') === '1' } catch (_) {}

let resolver: ((song: Song) => Promise<Resolved>) | null = null
let audio: AudioOutput | null = null
let customOutput: (() => AudioOutput) | null = null
let current: Resolved | null = null
let seq = 0
/** Where to start the next song that loads (the second it was left at, restored or chosen while paused). */
let resumeAt = 0
/** how long the current song has really played (seeks aside), and whether it already counted as listened */
let heard = 0
let lastTick = 0
let counted = false

// ---- the session: queue, song and second kept in this browser, so a reload or another day goes on from there ----
const SESSION = 'reproductor.session'
const SESSION_MAX = 2000   // songs of the queue kept
try {
  const saved = JSON.parse(localStorage.getItem(SESSION) || 'null')
  if (saved && Array.isArray(saved.queue) && saved.queue[saved.index]) {
    state.queue = saved.queue
    state.index = saved.index
    state.shuffle = !!saved.shuffle
    state.time = resumeAt = Math.max(0, Number(saved.time) || 0)
    state.duration = saved.queue[saved.index].duration || 0
  }
} catch (_) {}
let savedAt = 0
function saveSession() {
  savedAt = Date.now()
  try {
    if (state.index < 0 || !state.queue.length) { localStorage.removeItem(SESSION); return }
    const from = Math.max(0, Math.min(state.index - SESSION_MAX / 2, state.queue.length - SESSION_MAX))
    localStorage.setItem(SESSION, JSON.stringify({ queue: state.queue.slice(from, from + SESSION_MAX), index: state.index - from,
                                                   time: Math.floor(state.time), shuffle: state.shuffle }))
  } catch (_) {}
}
watch(() => [state.queue, state.index, state.shuffle], saveSession)
watch(() => state.time, () => { if (Date.now() - savedAt > 5000) saveSession() })
if (typeof window !== 'undefined') window.addEventListener('pagehide', saveSession)

export const player = state
export const nowPlaying = computed<Song | null>(() => state.queue[state.index] || null)
export const hasPrev = computed(() => state.index > 0 || (state.repeat && state.queue.length > 0))
export const hasNext = computed(() => state.index < state.queue.length - 1 || (state.repeat && state.queue.length > 0))

export function setResolver(fn: (song: Song) => Promise<Resolved>) { resolver = fn }

/** The app's own output (before anything plays): Android's, which goes on with the screen off. */
export function setOutput(make: () => AudioOutput) { customOutput = make }

function el(): AudioOutput {
  if (audio) return audio
  audio = customOutput ? customOutput() : htmlOutput()
  audio.setVolume(state.volume)
  audio.listen({
    time(t) {
      // listened: past half the song or 30 s of it (each play of it counts once)
      if (t > lastTick && t - lastTick < 2) heard += t - lastTick
      lastTick = t
      const song = state.queue[state.index]
      if (song && !counted && heard >= Math.min(30, (state.duration || 60) / 2)) { counted = true; recordPlay(song) }
      state.time = t
    },
    duration(d) { state.duration = d || state.queue[state.index]?.duration || 0 },
    play() { state.playing = true; mediaState() },
    pause() { state.playing = false; saveSession(); mediaState() },
    ended() { if (!next()) { state.playing = false } },
    moved(key) { moved(key) },
    error(message) {
      const song = state.queue[state.index]
      state.error = song ? `No se pudo reproducir «${song.title}»: ${message}` : message
    }
  })
  return audio
}

// ---- a continuous output (Android's) gets the songs around the current one, and says when it moves through them ----
/** songs before and after the current one the output gets */
const WINDOW = 25
/** the window as last sent: its songs' keys */
let sentWindow = ''
const windowKeys = (i: number) => state.queue.slice(Math.max(0, i - WINDOW), i + WINDOW + 1).map((s) => s.key).join('\n')

async function windowAround(i: number): Promise<{ items: OutputItem[]; index: number }> {
  const from = Math.max(0, i - WINDOW)
  const songs = state.queue.slice(from, i + WINDOW + 1)
  const items = await Promise.all(songs.map(async (s, j) => {
    if (from + j === i) return toItem(s, '')   // the current one: playAt puts its URL
    try { return toItem(s, (await resolver!(s)).url) } catch (_) { return null }
  }))
  // a song that cannot be resolved stays out
  const index = items.slice(0, i - from).filter(Boolean).length
  return { items: items.filter((x): x is OutputItem => !!x), index }
}
const toItem = (s: Song, url: string): OutputItem =>
  ({ key: s.key, url, title: s.title, artist: s.artist, album: s.album, cover: s.cover || null, duration: s.duration || 0 })

/** Sends the window again when the queue changes around the current song (only to a continuous output). */
let windowTimer: ReturnType<typeof setTimeout> | null = null
function refreshWindow() {
  if (!audio?.continuous || !audio.window || !audio.loaded || state.index < 0) return
  if (windowTimer) clearTimeout(windowTimer)
  windowTimer = setTimeout(async () => {
    windowTimer = null
    const at = state.index
    const keys = windowKeys(at)
    if (keys === sentWindow) return
    const mine = seq
    const { items, index } = await windowAround(at)
    if (mine !== seq || at !== state.index || !audio?.loaded) return
    const song = state.queue[at]
    try { items[index] = toItem(song, (await resolver!(song)).url) } catch (_) { return }
    if (mine !== seq || at !== state.index) return
    sentWindow = keys
    audio.window!(items, index)
  }, 300)
}
watch(() => [state.queue, state.index], refreshWindow)

/** The output went to another song of its window by itself (one ended, or the notification's buttons). */
function moved(key: string) {
  if (state.queue[state.index]?.key === key) return
  // the nearest song with that key (a queue may have it twice)
  let found = -1
  for (let d = 1; d <= state.queue.length && found < 0; d++) {
    if (state.queue[state.index + d]?.key === key) found = state.index + d
    else if (state.queue[state.index - d]?.key === key) found = state.index - d
  }
  if (found < 0) return
  seq++
  current?.release?.()
  current = null
  state.index = found
  state.time = 0
  state.duration = state.queue[found].duration || 0
  state.error = ''
  state.loading = false
  heard = 0
  lastTick = 0
  counted = false
  mediaSong(state.queue[found])
}

/** Plays the queue's song `i`; true once it sounds (false: it failed, or the user moved on meanwhile). */
async function playAt(i: number): Promise<boolean> {
  const song = state.queue[i]
  if (!song || !resolver) return false
  const a = el()
  const from = i === state.index ? resumeAt : 0
  resumeAt = 0
  state.index = i
  state.time = from
  state.duration = song.duration || 0
  state.loading = true
  state.error = ''
  const mine = ++seq
  heard = 0
  lastTick = from
  counted = false
  mediaSong(song)
  try {
    const resolved = await resolver(song)
    if (mine !== seq) { resolved.release?.(); return false }  // the user already moved on
    current?.release?.()
    current = resolved
    if (a.continuous) {
      const win = await windowAround(i)
      if (mine !== seq) return false
      win.items[win.index] = toItem(song, resolved.url)
      sentWindow = windowKeys(i)
      await a.load(win.items, win.index, from)
    } else {
      await a.load([toItem(song, resolved.url)], 0, from)
    }
    return mine === seq
  } catch (err: any) {
    // a browser tab never touched may not make sound by itself (autoplay): say what to do
    const status = err?.statusCode ?? err?.status ?? err?.response?.status
    const why = err?.name === 'NotAllowedError' ? 'el navegador no deja sonar una pestaña que no has tocado: pulsa ▶ en ella'
      : status === 404 || /not found/i.test(String(err?.message)) ? 'la canción ya no está en tu nube'
      : err?.message || String(err)
    if (mine === seq) state.error = `No se pudo reproducir «${song.title}»: ${why}`
    return false
  } finally {
    if (mine === seq) state.loading = false
  }
}

/** Play `pool` from `start` (or from the beginning / a random song). */
export function play(pool: Song[], start: Song | null = null, shuffle = state.shuffle) {
  if (start && nowPlaying.value?.key === start.key && pool.some((s) => s.key === start.key)) { toggle(); return }
  state.shuffle = shuffle
  resumeAt = 0   // a new queue starts at the start of its song
  const { queue, index } = queueFrom(pool, start, shuffle)
  state.queue = queue
  if (index >= 0) playAt(index)
}

/** Add songs right after the current one. */
export function playNext(songs: Song[]) {
  const at = state.index + 1
  const keys = new Set(songs.map((s) => s.key))
  const before = state.queue.slice(0, at).filter((s, i) => i === state.index || !keys.has(s.key))
  const after = state.queue.slice(at).filter((s) => !keys.has(s.key))
  state.index = before.length - 1
  state.queue = [...before, ...songs, ...after]
  if (state.index < 0) playAt(0)
}
export function enqueue(songs: Song[]) {
  const keys = new Set(state.queue.map((s) => s.key))
  state.queue = [...state.queue, ...songs.filter((s) => !keys.has(s.key))]
  if (state.index < 0) playAt(0)
}
export function jump(i: number) { playAt(i) }
export function removeAt(i: number) {
  if (i === state.index) return
  state.queue = state.queue.filter((_, j) => j !== i)
  if (i < state.index) state.index--
}

export function toggle() {
  const a = el()
  if (!a.loaded) { if (state.queue.length) playAt(Math.max(0, state.index)); return }
  if (a.paused) a.play().catch(() => {})
  else a.pause()
}
export function next(): boolean {
  if (state.index < state.queue.length - 1) { playAt(state.index + 1); return true }
  if (state.repeat && state.queue.length) {
    if (state.shuffle) state.queue = shuffled(state.queue)
    playAt(0)
    return true
  }
  return false
}
export function prev() {
  const a = el()
  if (a.currentTime > 3 || state.index <= 0) { a.seek(0); return }
  playAt(state.index - 1)
}
export function toggleShuffle() {
  state.shuffle = !state.shuffle
  const song = nowPlaying.value
  if (!song || !state.shuffle) return
  state.queue = [song, ...shuffled(state.queue.filter((s) => s.key !== song.key))]
  state.index = 0
}
/** Repeat the queue: when the last song ends, start again from the first (remembered). */
export function toggleRepeat() {
  state.repeat = !state.repeat
  try { localStorage.setItem('reproductor.repeat', state.repeat ? '1' : '0') } catch (_) {}
}
export function seekTo(fraction: number) {
  const a = el()
  if (!state.duration) return
  const t = Math.max(0, Math.min(1, fraction)) * state.duration
  if (!a.loaded) { resumeAt = state.time = t; saveSession(); return }   // not loaded yet: it starts there
  a.seek(t)
}
export function setVolume(v: number) {
  state.volume = v
  el().setVolume(v)
  try { localStorage.setItem('reproductor.volume', String(v)) } catch (_) {}
}
/** Pause (nothing if already paused). */
export function pause() {
  if (audio?.loaded && !audio.paused) audio.pause()
}
/** Play on (nothing if already playing). */
export function resume() {
  if (!state.playing) toggle()
}

/** A playback handed between devices (connect.ts): the queue, where in it and the second. */
export interface Session { queue: Song[]; index: number; time: number; shuffle: boolean; repeat: boolean }

/** The playback as it is now (the queue cut to `max` songs around the current one); null with nothing queued. */
export function currentSession(max = 1000): Session | null {
  if (state.index < 0 || !state.queue.length) return null
  const from = Math.max(0, Math.min(state.index - max / 2, state.queue.length - max))
  return { queue: state.queue.slice(from, from + max), index: state.index - from, time: Math.floor(state.time),
           shuffle: state.shuffle, repeat: state.repeat }
}

/** Takes a playback from another device: its queue, from its song and second (playing, unless `play` is false).
 *  Resolves whether it sounds (with `play`; the reason is in `player.error`). */
export async function startSession(s: Session, play = true): Promise<boolean> {
  if (!s?.queue?.[s.index]) { state.error = 'No llegó ninguna canción que reproducir'; return false }
  seq++
  state.queue = s.queue
  state.shuffle = !!s.shuffle
  if (state.repeat !== !!s.repeat) toggleRepeat()
  state.index = s.index
  state.time = resumeAt = Math.max(0, s.time || 0)
  state.duration = s.queue[s.index].duration || 0
  if (play) return playAt(s.index)
  if (audio) audio.clear()
  saveSession()
  return true
}

/** Leaving the app: silence, and give back the last song's URL. */
export function stop() {
  seq++
  resumeAt = state.time   // back in the app, the play goes on from here
  saveSession()
  if (audio) audio.clear()
  current?.release?.()
  current = null
  state.playing = false
  state.loading = false
}

// ---- the system's media controls (keyboard media keys, the volume flyout, the lock screen) ----
const media = typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null
function mediaSong(song: Song) {
  if (!media || typeof MediaMetadata === 'undefined') return
  try {
    media.metadata = new MediaMetadata({ title: song.title, artist: song.artist, album: song.album,
                                         artwork: song.cover ? [{ src: song.cover, sizes: '512x512' }] : [] })
  } catch (_) {}
}
function mediaState() {
  if (media) media.playbackState = state.playing ? 'playing' : 'paused'
}
if (media) {
  const on = (action: MediaSessionAction, fn: (d: MediaSessionActionDetails) => void) => { try { media.setActionHandler(action, fn) } catch (_) {} }
  on('play', () => { if (!state.playing) toggle() })
  on('pause', () => { if (state.playing) toggle() })
  on('previoustrack', () => prev())
  on('nexttrack', () => { next() })
  on('seekto', (d) => { if (d.seekTime !== undefined && state.duration) seekTo(d.seekTime / state.duration) })
}
