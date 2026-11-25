/**
 * The player: one audio element and its queue for the whole app, kept outside the components so
 * moving between pages never cuts the music. The app tells it how to turn a cloud path into
 * something the audio element can play (`setResolver`).
 */
import { computed, reactive, watch } from 'vue'
import { queueFrom, shuffled, type Song } from './library.ts'
import { recordPlay } from './mine.ts'

type Resolved = { url: string; release?: () => void }

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
let audio: HTMLAudioElement | null = null
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

function el(): HTMLAudioElement {
  if (audio) return audio
  audio = new Audio()
  audio.volume = state.volume
  audio.addEventListener('timeupdate', () => {
    const t = audio!.currentTime
    // listened: past half the song or 30 s of it (each play of it counts once)
    if (t > lastTick && t - lastTick < 2) heard += t - lastTick
    lastTick = t
    const song = state.queue[state.index]
    if (song && !counted && heard >= Math.min(30, (state.duration || 60) / 2)) { counted = true; recordPlay(song) }
    state.time = t
  })
  audio.addEventListener('durationchange', () => { state.duration = isFinite(audio!.duration) ? audio!.duration : 0 })
  audio.addEventListener('play', () => { state.playing = true; mediaState() })
  audio.addEventListener('pause', () => { state.playing = false; saveSession(); mediaState() })
  audio.addEventListener('ended', () => { if (!next()) { state.playing = false } })
  return audio
}

async function playAt(i: number) {
  const song = state.queue[i]
  if (!song || !resolver) return
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
    if (mine !== seq) { resolved.release?.(); return }  // the user already moved on
    current?.release?.()
    current = resolved
    a.src = resolved.url
    if (from) a.addEventListener('loadedmetadata', () => { if (mine === seq) a.currentTime = from }, { once: true })
    await a.play()
  } catch (err: any) {
    if (mine === seq) state.error = `No se pudo reproducir «${song.title}»: ${err?.message || err}`
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
  if (!a.src) { if (state.queue.length) playAt(Math.max(0, state.index)); return }
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
  if (a.currentTime > 3 || state.index <= 0) { a.currentTime = 0; return }
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
  if (!a.src) { resumeAt = state.time = t; saveSession(); return }   // not loaded yet: it starts there
  a.currentTime = t
}
export function setVolume(v: number) {
  state.volume = v
  el().volume = v
  try { localStorage.setItem('reproductor.volume', String(v)) } catch (_) {}
}
/** Leaving the app: silence, and give back the last song's URL. */
export function stop() {
  seq++
  resumeAt = state.time   // back in the app, the play goes on from here
  saveSession()
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load() }
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
