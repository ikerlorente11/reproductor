/**
 * What the user listens to, shared by all their devices (connected to a server): every song listened to goes to the
 * server's history (kept here meanwhile if there is no network), and each device keeps its playback there — the
 * queue, the song, the second. Each device goes on from its own playback when opened again (player.ts keeps it); what
 * another device plays is offered here only while it plays («Suena X en el móvil · Escuchar aquí»).
 */
import { reactive, watch } from 'vue'
import type { Api } from './api.ts'
import type { Me } from './connect.ts'
import { connect, bringHere, others } from './connect.ts'
import type { Song } from './library.ts'
import { onPlayed } from './mine.ts'
import { currentSession, player, type Session } from './player.ts'

const PENDING = 'reproductor.plays.pending'
const MINE = 'reproductor.handoff.mine'

export interface DeviceSession { device: string; name: string; kind: string; updated: number; session: Session }

/** What another device is playing right now: what the banner offers to bring here. */
export const handoff = reactive({ offer: null as DeviceSession | null })
/** the devices whose offer was turned down (till they stop playing) */
const declined = new Set<string>()

function pending(): { song: Song; at: number; device: string }[] {
  try { return JSON.parse(localStorage.getItem(PENDING) || '[]') } catch (_) { return [] }
}
function setPending(list: { song: Song; at: number; device: string }[]) {
  try { localStorage.setItem(PENDING, JSON.stringify(list.slice(-500))) } catch (_) {}
}
/** When this device last told where it was (seconds since 1970). */
function mineAt(): number { try { return Number(localStorage.getItem(MINE) || 0) } catch (_) { return 0 } }

let stops: (() => void)[] = []

/** Starts sharing: the history, this device's playback, and looking at the others' (now and when coming back to it). */
export function startHandoff(api: Api, me: Me) {
  stopHandoff()
  // ---- the history ----
  const flush = async () => {
    const list = pending()
    while (list.length) {
      try { await api.addPlay(list[0].song, list[0].at, list[0].device) } catch (err: any) { if (err?.status !== 400) break }
      list.shift()
      setPending(list)
    }
  }
  stops.push(onPlayed((song) => {
    if (song.device || !song.path?.startsWith('/')) return   // this device's own songs do not play elsewhere
    setPending([...pending(), { song, at: Date.now() / 1000, device: me.name }])
    flush()
  }))
  flush()

  // ---- this device's playback: when the queue or the song changes, every 30 s while playing, and on pausing or
  // leaving. It says when the user last really used it (`active`), not when it is sent: closing the app is no listening.
  let told = ''
  let active = mineAt()
  const tell = async (force = false) => {
    const s = currentSession()
    if (!s || !active) return
    const mark = `${s.queue.length}|${s.queue[s.index]?.key}|${s.index}|${Math.round(active)}`
    if (!force && mark === told) return
    told = mark
    try {
      localStorage.setItem(MINE, String(active))
      await api.putSession(me.id, { name: me.name, kind: me.kind, session: s, updated: active })
    } catch (_) { told = '' }
  }
  const used = () => { active = Date.now() / 1000; handoff.offer = null }
  stops.push(watch(() => [player.queue, player.index], () => { used(); tell() }))
  stops.push(watch(() => player.playing, (on) => { if (on) used(); else tell(true) }))
  const beat = setInterval(() => { if (player.playing) { used(); tell(true) } }, 30000)
  stops.push(() => clearInterval(beat))
  const leave = () => { if (player.playing) used(); tell(true) }
  window.addEventListener('pagehide', leave)
  stops.push(() => window.removeEventListener('pagehide', leave))

  // ---- the others': another device playing now is offered (not one that played some time ago: each device goes on
  // from its own playback). Nothing while this one plays, or while the player bar drives that device. ----
  const look = () => {
    const playing = others.value.filter((d) => d.state?.playing && d.state.song)
    for (const id of [...declined]) if (!playing.some((d) => d.id === id)) declined.delete(id)
    const d = player.playing ? null : playing.find((x) => !declined.has(x.id) && x.id !== connect.controlling)
    handoff.offer = d && d.state?.song ? {
      device: d.id, name: d.name, kind: d.kind, updated: Date.now() / 1000,
      session: { queue: [d.state.song as Song], index: 0, time: d.state.time, shuffle: d.state.shuffle, repeat: d.state.repeat }
    } : null
  }
  stops.push(watch(() => [others.value, player.playing, connect.controlling], look, { immediate: true }))
}

/** «No, gracias»: not offered again till that device stops playing. */
export function declineOffer() {
  if (handoff.offer) declined.add(handoff.offer.device)
  handoff.offer = null
}

export function stopHandoff() {
  stops.forEach((s) => s())
  stops = []
  handoff.offer = null
}

/** Brings here what the device offered plays (it stops there). */
export async function takeOffer(): Promise<boolean> {
  const offer = handoff.offer
  handoff.offer = null
  if (!offer) return false
  await bringHere(offer.device)
  return true
}
