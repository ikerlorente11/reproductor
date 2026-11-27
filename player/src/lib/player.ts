/**
 * The player: one audio output and its queue for the whole app, kept outside the components so
 * moving between pages never cuts the music. The app tells it how to turn a cloud path into
 * something the output can play (`setResolver`). The output is the browser's <audio> unless the app gives
 * its own (`setOutput`): Android's goes on with the screen off, where the page's JavaScript sleeps, so it gets a
 * window of the queue and moves through it by itself, telling the page which song it is on.
 */
import { computed, reactive, watch } from 'vue'
import { queueFrom, shuffled, type Song } from './library.ts'
import { recordPlay, type PlaySource } from './mine.ts'
import { analysisOf, analyze } from './analysis.ts'
import { activeBands, BANDS, setOutput as setEqOutput } from './eq.ts'
import { quality, QUALITIES } from './quality.ts'

type Resolved = { url: string; release?: () => void }

/** A song as an output gets it: where it plays from and what the system shows of it (notification, lock screen); and
 *  its sound (analysis.ts): `gain` (dB) to bring it to the same loudness as the others, and where its sound `start`s and
 *  `end`s (seconds; 0: from its start, to its end) to skip the silences at its edges. */
export interface OutputItem {
  key: string; url: string; title: string; artist: string; album: string; cover: string | null; duration: number
  gain?: number; start?: number; end?: number
}

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
  /** where a continuous output was last (its song and second, and when: ms since 1970), though it has nothing loaded now:
   *  it went on while the page slept and the app was closed meanwhile */
  resumed?(key: string, seconds: number, at: number): void
  /** the output stopped by itself for the sleep timer it was given (`sleep`) */
  slept?(): void
  /** where it sounds changed (the phone's speaker, its headphones, a Bluetooth device): a key and its name */
  output?(key: string, name: string): void
  error?(message: string): void
}

/** The sleep timer handed to an output that plays on by itself while the page sleeps: it stops at `at` (ms since 1970),
 *  or (`endOfSong`) at the end of the song playing, fading out the last `fade` seconds. */
export interface SleepTimer { at: number; endOfSong: boolean; fade: number }

/** What makes the sound. */
export interface AudioOutput {
  /** goes through the songs by itself: it gets a window of the queue around the current song (`load`, `window`) */
  readonly continuous?: boolean
  /** loads `items[index]` (with the songs around it, for a continuous output) and plays it from `from` seconds */
  load(items: OutputItem[], index: number, from: number): Promise<void>
  /** the songs around the current one changed (the queue was edited, or it moved on): the current one goes on */
  window?(items: OutputItem[], index: number): void
  /** the song that comes next (an output of one song at a time): it starts loading it, so that `load` of it sounds at
   *  once; null forgets it */
  preload?(item: OutputItem | null): void
  play(): Promise<void>
  pause(): void
  seek(seconds: number): void
  setVolume(volume: number): void
  /** faster or slower (1: as it is), the pitch kept */
  setRate?(rate: number): void
  /** the current song's gain (dB) changed (it was measured while it played, or normalising was switched) */
  setGain?(db: number): void
  /** the equaliser: a gain (dB) for each of eq.ts's BANDS; null: off */
  setEq?(bands: number[] | null): void
  /** raised beyond its maximum (dB, 0: not), held by a limiter so it does not distort */
  setBoost?(db: number): void
  /** the system's outputs it can sound on (the PC's speakers, its headphones…), and choosing one ('' : the system's) */
  sinks?(): Promise<{ id: string; name: string }[]>
  setSink?(id: string): Promise<void>
  /** a continuous output does the sleep timer itself (the page sleeps with the screen off): null cancels it */
  sleep?(timer: SleepTimer | null): void
  /** silence, and forget the song */
  clear(): void
  readonly paused: boolean
  readonly currentTime: number
  /** a song is loaded */
  readonly loaded: boolean
  listen(events: OutputEvents): void
}

/**
 * The browser's <audio>: one song at a time (the page says which comes next). Two of them: the one that sounds and
 * a spare that loads the next song beforehand (`preload`); when that one comes, they swap and it sounds at once.
 *
 * Both go through Web Audio (each its own gain: its song's, to bring it to the same loudness; then one limiter, so a
 * song raised does not clip): the circuit the equaliser will join. Web Audio leaves a song from another site in silence
 * if that site does not allow it (CORS): such a song (it fails to load as `crossOrigin`) plays again on a third <audio>
 * outside the circuit (its gain only lowers, with the volume), and its site's other songs go there from then on.
 */
export function htmlOutput(): AudioOutput {
  // ---- the circuit: made once, with the first song; without Web Audio, the elements play as they are ----
  const Ctx = typeof window !== 'undefined' ? (window.AudioContext || (window as any).webkitAudioContext) : null
  let ctx: AudioContext | null = null
  /** where every song's gain goes: the first of the equaliser's filters */
  let bus: AudioNode | null = null
  let filters: BiquadFilterNode[] = []
  let boost: GainNode | null = null
  const gains = new Map<HTMLAudioElement, GainNode>()
  function circuit(): AudioContext | null {
    if (ctx || !Ctx) return ctx
    try {
      ctx = new Ctx() as AudioContext
      // the equaliser: a shelf at each end, peaks in between (flat: each at 0 dB, nothing changes)
      filters = BANDS.map((hz, i) => {
        const f = ctx!.createBiquadFilter()
        f.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking'
        f.frequency.value = hz
        f.Q.value = 1.41
        f.gain.value = 0
        return f
      })
      filters.forEach((f, i) => { if (i) filters[i - 1].connect(f) })
      boost = ctx.createGain()
      const limiter = ctx.createDynamicsCompressor()
      // a limiter: only what would go over -1 dBFS is held back, at once
      limiter.threshold.value = -1
      limiter.knee.value = 0
      limiter.ratio.value = 20
      limiter.attack.value = 0.003
      limiter.release.value = 0.25
      filters[filters.length - 1].connect(boost).connect(limiter).connect(ctx.destination)
      bus = filters[0]
    } catch (_) { ctx = null }
    return ctx
  }
  /** an element of the circuit: its sound goes through its gain and the limiter (from then on, only through them) */
  function routed(): HTMLAudioElement {
    const x = new Audio()
    const c = circuit()
    if (!c || !bus) return x
    x.crossOrigin = 'anonymous'
    try {
      const g = c.createGain()
      c.createMediaElementSource(x).connect(g).connect(bus)
      gains.set(x, g)
    } catch (_) { x.removeAttribute('crossorigin') }
    return x
  }
  /** sites that do not allow their songs into Web Audio (their songs play on `bare`) */
  const noCors = new Set<string>()
  const originOf = (url: string) => { try { return new URL(url, location.href).origin } catch (_) { return '' } }
  const outside = (url: string) => /^https?:/i.test(new URL(url, location.href).protocol) && originOf(url) !== location.origin

  let a = routed()
  let spare = routed()
  const bare = new Audio()
  spare.preload = 'auto'
  let at = 0
  let on: OutputEvents | null = null
  let volume = 1
  /** each element's song's gain (linear) */
  const level = new Map<HTMLAudioElement, number>()
  const empty = (x: HTMLAudioElement) => { x.pause(); x.removeAttribute('src'); x.load() }
  const durationOf = (x: HTMLAudioElement) => (isFinite(x.duration) ? x.duration : 0)
  /** a song's gain on its element: in the circuit, its gain node (smoothly); outside it, the volume (it can only lower) */
  function gainOn(x: HTMLAudioElement, db = 0) {
    const linear = Math.pow(10, (db || 0) / 20)
    level.set(x, linear)
    const g = gains.get(x)
    if (g && ctx) g.gain.setTargetAtTime(linear, ctx.currentTime, 0.08)
    x.volume = g ? volume : Math.min(1, volume * linear)
  }
  /** the events of the one that sounds; the spare's (its loading) are not the player's business */
  function follow(x: HTMLAudioElement) {
    const mine = (fn: () => void) => () => { if (x === a && on) fn() }
    x.addEventListener('timeupdate', mine(() => on!.time(x.currentTime)))
    x.addEventListener('durationchange', mine(() => on!.duration(durationOf(x))))
    x.addEventListener('play', mine(() => on!.play()))
    x.addEventListener('pause', mine(() => on!.pause()))
    x.addEventListener('ended', mine(() => on!.ended()))
    // a site that does not allow Web Audio, found while preloading: its songs go outside the circuit (the one that
    // sounds is played again by `load`, whose play() fails)
    x.addEventListener('error', () => {
      const url = x.getAttribute('src') || ''
      if (x !== spare || !gains.has(x) || !url || !outside(url)) return
      noCors.add(originOf(url))
      empty(spare)
    })
  }
  follow(a)
  follow(spare)
  follow(bare)
  /** the element a song goes on: outside the circuit if its site refused it, else one of the circuit's */
  const placeFor = (url: string) => (noCors.has(originOf(url)) || !gains.size ? 'bare' : 'circuit')

  const output: AudioOutput = {
    async load(items, index, from) {
      const seq = ++at
      const item = items[index]
      const url = item.url
      if (placeFor(url) === 'bare') {
        if (a !== bare) { empty(a); a = bare }
        bare.src = url
      } else if (a === bare) {
        empty(bare)
        // back in the circuit: on the element that is not the spare
        a = [...gains.keys()].find((x) => x !== spare) || routed()
        a.src = url
      } else if (spare.getAttribute('src') === url) {
        // the spare has it loaded already: it becomes the one that sounds
        const old = a
        a = spare
        spare = old
        empty(old)
        a.currentTime = 0
        on?.duration(durationOf(a))
      } else {
        a.src = url
        if (spare.getAttribute('src')) empty(spare)
      }
      gainOn(a, item.gain)
      if (from) {
        if (a.readyState >= HTMLMediaElement.HAVE_METADATA) a.currentTime = from
        else a.addEventListener('loadedmetadata', () => { if (seq === at) a.currentTime = from }, { once: true })
      }
      // the circuit wakes with the first song played (a browser keeps it asleep until the page is touched)
      if (ctx && ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))])
      try {
        await a.play()
      } catch (err: any) {
        // it could not be loaded from another site in the circuit: perhaps it does not allow it (CORS); outside it
        if (err?.name === 'NotSupportedError' && gains.has(a) && outside(url) && !noCors.has(originOf(url)) && seq === at) {
          noCors.add(originOf(url))
          return output.load(items, index, from)
        }
        throw err
      }
    },
    preload(item) {
      if (!item || placeFor(item.url) === 'bare') { if (spare.getAttribute('src')) empty(spare); return }
      if (spare.getAttribute('src') === item.url) return
      gainOn(spare, item.gain)
      spare.src = item.url
      spare.load()
    },
    async play() {
      if (ctx && ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))])
      return a.play()
    },
    pause: () => a.pause(),
    // a second chosen while it loads wins over the one it was loading at
    seek: (t) => { at++; a.currentTime = t },
    setVolume(v) {
      volume = v
      for (const x of [a, spare, bare]) x.volume = gains.has(x) ? v : Math.min(1, v * (level.get(x) ?? 1))
    },
    setRate(r) { for (const x of [a, spare, bare]) { x.defaultPlaybackRate = r; x.playbackRate = r; x.preservesPitch = true } },
    setGain(db) { gainOn(a, db) },
    setEq(bands) {
      if (!ctx) return
      filters.forEach((f, i) => f.gain.setTargetAtTime(bands?.[i] || 0, ctx!.currentTime, 0.05))
    },
    setBoost(db) {
      if (ctx && boost) boost.gain.setTargetAtTime(Math.pow(10, Math.max(0, db) / 20), ctx.currentTime, 0.05)
    },
    // the system names its outputs only to a page allowed the microphone (without it, a single nameless one)
    async sinks() {
      const all = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || []
      return all.filter((d) => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, name: d.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '') || `Salida ${i + 1}` }))
    },
    async setSink(id) {
      const c = circuit() as any
      if (c?.setSinkId) await c.setSinkId(id)
      if ((bare as any).setSinkId) await (bare as any).setSinkId(id).catch(() => {})
    },
    clear() { at++; empty(a); if (spare.getAttribute('src')) empty(spare); if (a !== bare && bare.getAttribute('src')) empty(bare) },
    get paused() { return a.paused },
    get currentTime() { return a.currentTime },
    get loaded() { return !!a.getAttribute('src') },
    listen(events) { on = events }
  }
  return output
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
  error: '',
  /** where the queue was started from (a list, say): what its songs count for in «Lo que más escuchas» */
  source: null as PlaySource | null,
  /** how fast it plays (1: as it is) */
  rate: 1,
  /** the sleep timer: it stops at this time (ms since 1970; 0: no), or at the end of the song playing (`sleepSong`) */
  sleepAt: 0,
  sleepSong: false
})
try { state.volume = Number(localStorage.getItem('reproductor.volume') ?? 1) } catch (_) {}
try { state.rate = Math.min(3, Math.max(0.25, Number(localStorage.getItem('reproductor.rate') ?? 1) || 1)) } catch (_) {}
try { state.repeat = localStorage.getItem('reproductor.repeat') === '1' } catch (_) {}

let resolver: ((song: Song) => Promise<Resolved>) | null = null
let audio: AudioOutput | null = null
let customOutput: (() => AudioOutput) | null = null
let current: Resolved | null = null
let seq = 0
/** Where to start the next song that loads (the second it was left at, restored or chosen while paused). */
let resumeAt = 0
/** when the playback last really changed (its queue, its song, its second): ms since 1970 */
let changedAt = 0
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
    state.source = saved.source || null
    state.time = resumeAt = Math.max(0, Number(saved.time) || 0)
    state.duration = saved.queue[saved.index].duration || 0
    changedAt = Number(saved.at) || 0
  }
} catch (_) {}
let savedAt = 0
function saveSession() {
  savedAt = Date.now()
  try {
    if (state.index < 0 || !state.queue.length) { localStorage.removeItem(SESSION); return }
    const from = Math.max(0, Math.min(state.index - SESSION_MAX / 2, state.queue.length - SESSION_MAX))
    localStorage.setItem(SESSION, JSON.stringify({ queue: state.queue.slice(from, from + SESSION_MAX), index: state.index - from,
                                                   time: Math.floor(state.time), shuffle: state.shuffle, source: state.source, at: changedAt }))
  } catch (_) {}
}
watch(() => [state.queue, state.index, state.shuffle, state.source], () => { changedAt = Date.now(); saveSession() })
watch(() => state.time, () => { changedAt = Date.now(); if (Date.now() - savedAt > 5000) saveSession() })
if (typeof window !== 'undefined') window.addEventListener('pagehide', saveSession)

export const player = state
export const nowPlaying = computed<Song | null>(() => state.queue[state.index] || null)
export const hasPrev = computed(() => state.index > 0 || (state.repeat && state.queue.length > 0))
export const hasNext = computed(() => state.index < state.queue.length - 1 || (state.repeat && state.queue.length > 0))

export function setResolver(fn: (song: Song) => Promise<Resolved>) { resolver = fn }

/** Where a queue started now comes from, unless `play` is told: the app says (the page on screen). */
let sourceOf: (() => PlaySource | null) | null = null
export function setSourceOf(fn: () => PlaySource | null) { sourceOf = fn }

/** The app's own output (before anything plays): Android's, which goes on with the screen off. */
export function setOutput(make: () => AudioOutput) {
  customOutput = make
  // made now, not on the first play: it may be sounding already (the page was loaded again while it played) and says so
  if (!audio) el()
}

function el(): AudioOutput {
  if (audio) return audio
  audio = customOutput ? customOutput() : htmlOutput()
  audio.setVolume(state.volume)
  if (state.rate !== 1) audio.setRate?.(state.rate)
  audio.setEq?.(activeBands.value)
  if (sound.boost) audio.setBoost?.(sound.boost)
  if (audio.setSink) chooseSink(sound.sink)
  audio.listen({
    time(t) {
      // listened: past half the song or 30 s of it (each play of it counts once)
      if (t > lastTick && t - lastTick < 2) heard += t - lastTick
      lastTick = t
      const song = state.queue[state.index]
      if (song && !counted && heard >= Math.min(30, (state.duration || 60) / 2)) { counted = true; recordPlay(song, state.source) }
      state.time = t
      const end = audio?.continuous ? 0 : soundOf(state.index).end || 0
      if (state.duration && (end || state.duration) - t <= PRELOAD_BEFORE) preloadNext()
      keepPosition()
      // past the end of its sound (its silence after it skipped): it ended
      if (end && t >= end && endedAt !== seq) { endedAt = seq; songEnded() }
    },
    duration(d) { state.duration = d || state.queue[state.index]?.duration || 0 },
    play() { state.playing = true; mediaState() },
    pause() { state.playing = false; saveSession(); mediaState() },
    ended() { if (endedAt !== seq) { endedAt = seq; songEnded() } },
    slept() { if (state.sleepAt || state.sleepSong) endSleep() },
    output(key, name) { setEqOutput(key, name) },
    moved(key) { moved(key) },
    resumed(key, seconds, at) { resumed(key, seconds, at) },
    error(message) {
      const song = state.queue[state.index]
      state.error = song ? `No se pudo reproducir «${song.title}»: ${message}` : message
    }
  })
  return audio
}

/** The song came to its end (or to the end of its sound). */
let endedAt = -1
function songEnded() {
  // the sleep timer at the end of the song: it stops here, ready to start the next one
  if (state.sleepSong && !audio?.sleep) { restAfter(); return }
  if (next()) return
  audio?.pause()
  state.playing = false
  // the queue ended: the radio goes on (if it is on and finds songs)
  const at = state.index
  extendWithRadio().then((more) => { if (more && state.index === at && !state.playing) next() })
}

// ---- the radio (radio.ts): when the queue is about to end, it goes on with songs like the last ones ----
const RADIO = 'reproductor.radio'
/** the setting (Ajustes › Reproducción; off unless switched on) */
export const radio = reactive({ on: false, /** songs it added (to say so in the queue) */ added: 0 })
try { radio.on = localStorage.getItem(RADIO) === '1' } catch (_) {}
watch(() => radio.on, (on) => {
  try { localStorage.setItem(RADIO, on ? '1' : '0') } catch (_) {}
  if (on) nearTheEnd()
})
/** what finds the songs (the app gives it: it knows the library and how to reach Deezer) */
let radioFinder: ((seeds: Song[], exclude: Set<string>) => Promise<Song[]>) | null = null
export function setRadio(fn: (seeds: Song[], exclude: Set<string>) => Promise<Song[]>) { radioFinder = fn }
let extending: Promise<boolean> | null = null
/** the queue being extended (another one started meanwhile: once that ends, this one is) */
let extendingFor: Song[] | null = null
/** Adds the radio's songs at the end of the queue; true if it added any. */
function extendWithRadio(): Promise<boolean> {
  if (!radio.on || !radioFinder || state.repeat || !state.queue.length) return Promise.resolve(false)
  if (extending) return extendingFor === state.queue ? extending : extending.then(() => extendWithRadio())
  const queue = state.queue
  extendingFor = queue
  extending = radioFinder(queue.slice(-5), new Set(queue.map((s) => s.key)))
    .then((songs) => {
      // the queue changed meanwhile (another one was started): these do not go after it
      if (!songs.length || state.queue !== queue) return false
      state.queue = [...queue, ...songs]
      radio.added += songs.length
      return true
    })
    .catch(() => false)
    .finally(() => { extending = null; extendingFor = null })
  return extending
}
/** Two songs from the end: the radio adds its songs now (the next one can load beforehand; a continuous output gets them
 *  in its window, and goes on with them while the page sleeps). */
function nearTheEnd() {
  if (radio.on && state.index >= 0 && state.index >= state.queue.length - 2) extendWithRadio()
}
watch(() => [state.index, state.queue.length], nearTheEnd)

// ---- the sound of each song: all at the same loudness, without the silences at their edges (analysis.ts) ----
/** the loudness every song is brought to (LUFS: Spotify's «normal») */
const TARGET = -14
/** how much a song is lowered or raised at most (dB); a raised one goes through the limiter */
const MAX_CUT = -15
const MAX_BOOST = 6
const SOUND = 'reproductor.sound'
/** the settings (Ajustes): normalise the volume, skip the silences at the edges; both on unless switched off */
export const sound = reactive({
  normalize: true,
  trim: true,
  /** raised beyond the maximum (dB, 0 … 12), with a limiter */
  boost: 0,
  /** the output chosen (an id of `outputs()`; '': the system's) */
  sink: ''
})
try { Object.assign(sound, JSON.parse(localStorage.getItem(SOUND) || '{}')) } catch (_) {}
watch(sound, () => {
  try { localStorage.setItem(SOUND, JSON.stringify(sound)) } catch (_) {}
  soundChanged()
})

/** A line of how it plays (Ajustes' list): the radio and the servers' quality. */
export const playbackSummary = computed(() => {
  const q = QUALITIES.find((x) => x.key === quality.wifi)?.name || ''
  return [radio.on ? 'Radio al acabar' : 'Sin radio', `calidad ${q.toLowerCase()}`].join(' · ')
})

/** A line of how the sound is now (Ajustes' list). */
export const soundSummary = computed(() => [
  sound.normalize ? 'Volumen igualado' : 'Volumen sin igualar',
  sound.trim ? 'sin silencios' : '',
  sound.boost ? `+${sound.boost} dB` : ''
].filter(Boolean).join(' · '))

/** Two songs of the same record (one after the other in the queue, as the record has them: not shuffled). */
function sameRecord(a?: Song, b?: Song): boolean {
  if (!a || !b || state.shuffle) return false
  if (a.releaseId && b.releaseId) return a.releaseId === b.releaseId
  if (a.albumKey && b.albumKey) return a.albumKey === b.albumKey
  return !!a.album && a.album === b.album && a.artist === b.artist
}
/** The queue's song `i`'s sound, as far as it is measured: its gain (dB) and where its sound starts and ends (0: no cut).
 *  The silence between two songs of the same record is kept (records whose songs run into each other). */
function soundOf(i: number): { gain: number; start: number; end: number } {
  const song = state.queue[i]
  const a = song && analysisOf(song.key)
  if (!a) return { gain: 0, start: 0, end: 0 }
  const gain = sound.normalize && a.lufs !== null ? Math.round(Math.max(MAX_CUT, Math.min(MAX_BOOST, TARGET - a.lufs)) * 10) / 10 : 0
  const start = sound.trim && a.start >= 0.2 && !sameRecord(state.queue[i - 1], song) ? Math.round(a.start * 100) / 100 : 0
  const end = sound.trim && a.duration - a.end >= 0.5 && !sameRecord(song, state.queue[i + 1]) ? Math.round(a.end * 100) / 100 : 0
  return { gain, start, end }
}

/** The song playing is measured (the first time: it already plays meanwhile, as it is); once it is, its gain is put
 *  and, if it is still in its first silence, it goes to where its sound starts. */
async function measureCurrent(i: number, url: string, mine: number) {
  const song = state.queue[i]
  if (!song || analysisOf(song.key)) return
  await analyze(song.key, url, song.duration)
  if (mine !== seq || !audio) return
  const x = soundOf(i)
  audio.setGain?.(x.gain)
  if (x.start && audio.currentTime < x.start && audio.currentTime < 3) audio.seek(x.start)
}
/** The next song is measured while this one plays (its URL asked for it, and given back). */
async function measureAhead(mine: number) {
  const i = state.index < state.queue.length - 1 ? state.index + 1 : -1
  const song = state.queue[i]
  if (!song || !resolver || analysisOf(song.key) || mine !== seq) return
  try {
    const r = await resolver(song)
    try { await analyze(song.key, r.url, song.duration) } finally { r.release?.() }
  } catch (_) {}
}
/** A continuous output's window: the songs coming next are measured (a few, one after another); each one measured,
 *  the window is sent again with it. */
const AHEAD = 3
function measureWindow(items: OutputItem[], index: number) {
  for (const it of items.slice(index, index + 1 + AHEAD)) {
    if (!it.url || analysisOf(it.key)) continue
    analyze(it.key, it.url, it.duration).then((a) => { if (a) refreshWindow() })
  }
}
/** The settings changed: the song playing takes them now (a continuous output, with its window). */
function soundChanged() {
  if (!audio) return
  audio.setBoost?.(sound.boost)
  if (state.index < 0) return
  if (audio.continuous) refreshWindow()
  else audio.setGain?.(soundOf(state.index).gain)
}
watch(activeBands, (bands) => audio?.setEq?.(bands))
watch(() => sound.sink, (id) => { if (audio) chooseSink(id) })

/** The system's outputs this app can choose among (none: it cannot choose, it sounds where the system says); `locked`:
 *  it could, but the system names them only once the microphone is allowed (`unlockOutputs`). */
export async function outputs(): Promise<{ list: { id: string; name: string }[]; locked: boolean }> {
  const a = el()
  if (!a.setSink || !a.sinks) return { list: [], locked: false }
  const list = await a.sinks()
  return { list, locked: !list.length && !!navigator.mediaDevices?.getUserMedia }
}
/** Asks the microphone once, only so the system names its outputs: let go at once, nothing is recorded. */
export async function unlockOutputs(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return true
  } catch (_) { return false }
}
/** Sounds on that output; its name is where the equaliser's setting for each output is kept. */
async function chooseSink(id: string) {
  const a = el()
  if (!a.setSink) return
  try {
    await a.setSink(id)
    const name = id ? (await a.sinks?.())?.find((s) => s.id === id)?.name || 'Salida' : 'La del sistema'
    setEqOutput(id || 'default', name)
  } catch (_) {
    // gone (unplugged): the system's
    if (id) sound.sink = ''
  }
}

// ---- an output of one song at a time (the browser's) gets the next one before the current one ends ----
/** seconds before the end of a song when the next one starts loading */
const PRELOAD_BEFORE = 30
/** the next song, resolved and handed to the output to load (`preloading`: on its way) */
let preloaded: { key: string; resolved: Resolved } | null = null
let preloading = ''

/** The song that comes after the current one, if it is known now (a repeated queue shuffles again: not known). */
function upcoming(): Song | null {
  if (state.index < state.queue.length - 1) return state.queue[state.index + 1]
  if (state.repeat && !state.shuffle && state.queue.length) return state.queue[0]
  return null
}

async function preloadNext() {
  if (!audio?.preload || audio.continuous || !resolver) return
  const song = upcoming()
  if (preloaded && preloaded.key !== song?.key) dropPreloaded()   // the queue changed after the current song
  if (!song || preloaded || preloading === song.key) return
  preloading = song.key
  const mine = seq
  try {
    const resolved = await resolver(song)
    if (mine !== seq || preloading !== song.key || upcoming()?.key !== song.key) { resolved.release?.(); return }
    preloaded = { key: song.key, resolved }
    audio.preload(toItem(song, resolved.url, state.index < state.queue.length - 1 ? state.index + 1 : 0))
  } catch (_) {
    // it will be tried again when it comes
  } finally {
    if (preloading === song.key) preloading = ''
  }
}

/** The preloaded song for `song`, taken (null if it was another: then it is forgotten). */
function takePreloaded(song: Song): Resolved | null {
  if (preloaded?.key === song.key) { const r = preloaded.resolved; preloaded = null; return r }
  dropPreloaded()
  return null
}
function dropPreloaded() {
  preloading = ''
  if (!preloaded) return
  audio?.preload?.(null)
  preloaded.resolved.release?.()
  preloaded = null
}

// ---- the speed ----
/** Faster or slower (1: as it is; kept for the next times). */
export function setRate(rate: number) {
  state.rate = Math.min(3, Math.max(0.25, rate))
  el().setRate?.(state.rate)
  try { localStorage.setItem('reproductor.rate', String(state.rate)) } catch (_) {}
}

// ---- long songs (sessions, audiobooks, podcasts): each one goes on where it was left ----
/** from this long (seconds) a song is remembered where it was left */
const LONG = 20 * 60
const POSITIONS = 'reproductor.positions'
const POSITIONS_MAX = 200
let positions: Record<string, { t: number; at: number }> = {}
try { positions = JSON.parse(localStorage.getItem(POSITIONS) || '{}') || {} } catch (_) {}
let positionSavedAt = 0
const isLong = (song: Song | undefined, duration = 0) => !!song && Math.max(song.duration || 0, duration) >= LONG
/** Where a long song was left (0: from its start; also when it was nearly finished). */
function keptPosition(song: Song | undefined): number {
  return song && isLong(song) ? positions[song.key]?.t || 0 : 0
}
function savePositions() {
  const keys = Object.keys(positions)
  if (keys.length > POSITIONS_MAX) {
    for (const k of keys.sort((a, b) => positions[a].at - positions[b].at).slice(0, keys.length - POSITIONS_MAX)) delete positions[k]
  }
  try { localStorage.setItem(POSITIONS, JSON.stringify(positions)) } catch (_) {}
}
/** As a long song plays (every few seconds): where it is; heard to its last minute, it starts from the start next time. */
function keepPosition() {
  const song = state.queue[state.index]
  if (!song || !isLong(song, state.duration) || Date.now() - positionSavedAt < 5000) return
  positionSavedAt = Date.now()
  const duration = state.duration || song.duration || 0
  if (state.time > 30 && duration - state.time > 60) positions[song.key] = { t: Math.floor(state.time), at: Date.now() }
  else if (positions[song.key]) delete positions[song.key]
  else return
  savePositions()
}

// ---- the sleep timer: it stops in a while, or at the end of the song, fading out its last seconds ----
/** seconds of fading out before it stops */
const SLEEP_FADE = 10
let sleepTicker: ReturnType<typeof setInterval> | null = null

/** Stops in `minutes`, or at the end of the song playing ('song'); null cancels it. */
export function setSleep(when: number | 'song' | null) {
  const a = el()
  state.sleepAt = typeof when === 'number' ? Date.now() + when * 60000 : 0
  state.sleepSong = when === 'song'
  a.setVolume(state.volume)
  if (a.sleep) {
    // the output does it (it plays on while the page sleeps) and says when it stopped (`slept`)
    a.sleep(when === null ? null : { at: state.sleepAt, endOfSong: state.sleepSong, fade: SLEEP_FADE })
    return
  }
  if (sleepTicker) clearInterval(sleepTicker)
  sleepTicker = when === null ? null : setInterval(sleepTick, 250)
}
/** Seconds left to stop (null: not known yet, the song's length). */
export function sleepLeft(): number | null {
  if (state.sleepAt) return Math.max(0, (state.sleepAt - Date.now()) / 1000)
  if (state.sleepSong) return state.duration ? Math.max(0, (state.duration - state.time) / (state.rate || 1)) : null
  return null
}
function sleepTick() {
  if (!state.sleepAt && !state.sleepSong) { endSleep(); return }
  const left = sleepLeft()
  if (left === null) return
  // at the end of the song its own end stops it (ended → restAfter); at a time, here
  if (state.sleepAt && left <= 0) {
    if (audio?.loaded && !audio.paused) audio.pause()
    endSleep()
    return
  }
  audio?.setVolume(state.volume * (state.playing && left < SLEEP_FADE ? Math.max(0, left / SLEEP_FADE) : 1))
}
/** The timer is over (or cancelled): the volume as it was. */
function endSleep() {
  if (sleepTicker) { clearInterval(sleepTicker); sleepTicker = null }
  state.sleepAt = 0
  state.sleepSong = false
  audio?.setVolume(state.volume)
}
/** The song ended with the timer at its end: silence, the next one ready (▶ starts it). */
function restAfter() {
  endSleep()
  const after = state.index < state.queue.length - 1 ? state.index + 1 : state.repeat && !state.shuffle && state.queue.length ? 0 : -1
  seq++
  dropPreloaded()
  audio?.clear()
  current?.release?.()
  current = null
  state.playing = false
  if (after >= 0) {
    state.index = after
    state.duration = state.queue[after].duration || 0
    mediaSong(state.queue[after])
  }
  state.time = resumeAt = 0
  saveSession()
  mediaState()
}

// ---- a continuous output (Android's) gets the songs around the current one, and says when it moves through them ----
/** songs before and after the current one the output gets */
const WINDOW = 25
/** the window as last sent: its songs' keys */
let sentWindow = ''
/** the window's songs and their sound (measured later, or the settings changed: it is sent again) */
const windowKeys = (i: number) => {
  const from = Math.max(0, i - WINDOW)
  return state.queue.slice(from, i + WINDOW + 1).map((s, j) => { const x = soundOf(from + j); return [s.key, x.gain, x.start, x.end].join('|') }).join('\n')
}

async function windowAround(i: number): Promise<{ items: OutputItem[]; index: number }> {
  const from = Math.max(0, i - WINDOW)
  const songs = state.queue.slice(from, i + WINDOW + 1)
  const items = await Promise.all(songs.map(async (s, j) => {
    if (from + j === i) return toItem(s, '', i)   // the current one: playAt puts its URL
    try { return toItem(s, (await resolver!(s)).url, from + j) } catch (_) { return null }
  }))
  // a song that cannot be resolved stays out
  const index = items.slice(0, i - from).filter(Boolean).length
  return { items: items.filter((x): x is OutputItem => !!x), index }
}
const toItem = (s: Song, url: string, i: number): OutputItem =>
  ({ key: s.key, url, title: s.title, artist: s.artist, album: s.album, cover: s.cover || null, duration: s.duration || 0, ...soundOf(i) })

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
    try { items[index] = toItem(song, (await resolver!(song)).url, at) } catch (_) { return }
    if (mine !== seq || at !== state.index) return
    sentWindow = keys
    audio.window!(items, index)
    measureWindow(items, index)
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
  // a long song it went to by itself: where it was left (if it has only just started)
  const kept = keptPosition(state.queue[found])
  if (kept && audio && audio.currentTime < 10) audio.seek(kept)
}

/** The output kept where it went while this page slept (the app was closed meanwhile): the queue goes on from there,
 *  if that is newer than what this page knew and the song is in its queue (the nearest to where it was). */
function resumed(key: string, seconds: number, at: number) {
  if (at <= changedAt || audio?.loaded || state.playing) return
  let found = state.queue[state.index]?.key === key ? state.index : -1
  for (let d = 1; d <= state.queue.length && found < 0; d++) {
    if (state.queue[state.index + d]?.key === key) found = state.index + d
    else if (state.queue[state.index - d]?.key === key) found = state.index - d
  }
  if (found < 0) return
  state.index = found
  state.time = resumeAt = Math.max(0, seconds)
  state.duration = state.queue[found].duration || 0
  changedAt = at
  saveSession()
}

/** Plays the queue's song `i`; true once it sounds (false: it failed, or the user moved on meanwhile). */
async function playAt(i: number): Promise<boolean> {
  const song = state.queue[i]
  if (!song || !resolver) return false
  const a = el()
  // where it was left; a long one, where it was left last time; else where its sound starts (its silence skipped)
  const from = (i === state.index ? resumeAt : 0) || keptPosition(song) || soundOf(i).start || 0
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
    const resolved = takePreloaded(song) ?? await resolver(song)
    if (mine !== seq) { resolved.release?.(); return false }  // the user already moved on
    current?.release?.()
    current = resolved
    if (a.continuous) {
      const win = await windowAround(i)
      if (mine !== seq) return false
      win.items[win.index] = toItem(song, resolved.url, i)
      sentWindow = windowKeys(i)
      await a.load(win.items, win.index, from)
      measureWindow(win.items, win.index)
    } else {
      await a.load([toItem(song, resolved.url, i)], 0, from)
      measureCurrent(i, resolved.url, mine).then(() => measureAhead(mine))
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

/** Play `pool` from `start` (or from the beginning / a random song). `source`: where it comes from (else the page's). */
export function play(pool: Song[], start: Song | null = null, shuffle = state.shuffle, source?: PlaySource | null) {
  if (start && nowPlaying.value?.key === start.key && pool.some((s) => s.key === start.key)) { toggle(); return }
  state.shuffle = shuffle
  state.source = source !== undefined ? source : sourceOf?.() ?? null
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
export interface Session { queue: Song[]; index: number; time: number; shuffle: boolean; repeat: boolean; source?: PlaySource | null }

/** The playback as it is now (the queue cut to `max` songs around the current one); null with nothing queued. */
export function currentSession(max = 1000): Session | null {
  if (state.index < 0 || !state.queue.length) return null
  const from = Math.max(0, Math.min(state.index - max / 2, state.queue.length - max))
  return { queue: state.queue.slice(from, from + max), index: state.index - from, time: Math.floor(state.time),
           shuffle: state.shuffle, repeat: state.repeat, source: state.source }
}

/** Takes a playback from another device: its queue, from its song and second (playing, unless `play` is false).
 *  Resolves whether it sounds (with `play`; the reason is in `player.error`). */
export async function startSession(s: Session, play = true): Promise<boolean> {
  if (!s?.queue?.[s.index]) { state.error = 'No llegó ninguna canción que reproducir'; return false }
  seq++
  state.queue = s.queue
  state.shuffle = !!s.shuffle
  state.source = s.source || null
  if (state.repeat !== !!s.repeat) toggleRepeat()
  state.index = s.index
  state.time = resumeAt = Math.max(0, s.time || 0)
  state.duration = s.queue[s.index].duration || 0
  if (play) return playAt(s.index)
  dropPreloaded()
  if (audio) audio.clear()
  saveSession()
  return true
}

/** Leaving the app: silence, and give back the last song's URL. */
export function stop() {
  seq++
  resumeAt = state.time   // back in the app, the play goes on from here
  saveSession()
  dropPreloaded()
  if (state.sleepAt || state.sleepSong) setSleep(null)
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
