/**
 * What the user listens to, shared by all their devices (connected to a server): every song listened to goes to the
 * server's history (kept here meanwhile if there is no network), and each device keeps its playback there — the
 * queue, the song, the second — so another device can go on from it though this one is closed («Seguir escuchando»).
 */
import { reactive, watch } from 'vue'
import type { Api } from './api.ts'
import type { Me } from './connect.ts'
import { connect, bringHere } from './connect.ts'
import type { Song } from './library.ts'
import { onPlayed } from './mine.ts'
import { currentSession, player, startSession, type Session } from './player.ts'

const PENDING = 'reproductor.plays.pending'
const MINE = 'reproductor.handoff.mine'

export interface DeviceSession { device: string; name: string; kind: string; updated: number; session: Session }

/** Another device's playback newer than this one's: what the banner offers to go on with. */
export const handoff = reactive({ offer: null as DeviceSession | null })

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

  // ---- the others': a newer playback than this one's is offered (on starting and on coming back to the app) ----
  const look = async () => {
    if (player.playing) { handoff.offer = null; return }
    try {
      const all = await api.sessions()
      const newest = all.find((s) => s.device !== me.id)
      const mine = Math.max(mineAt(), all.find((s) => s.device === me.id)?.updated || 0)
      const current = player.queue[player.index]?.key
      const theirs = newest?.session.queue[newest.session.index]
      handoff.offer = newest && theirs && newest.updated > mine + 30 &&
        !(theirs.key === current && Math.abs((newest.session.time || 0) - player.time) < 15) ? newest : null
    } catch (_) { /* nothing to offer */ }
  }
  look()
  const visible = () => { if (document.visibilityState === 'visible') look() }
  document.addEventListener('visibilitychange', visible)
  stops.push(() => document.removeEventListener('visibilitychange', visible))
}

export function stopHandoff() {
  stops.forEach((s) => s())
  stops = []
  handoff.offer = null
}

/** Goes on with the playback offered: brought from the device if it is still connected, else from where it was kept. */
export async function takeOffer(): Promise<boolean> {
  const offer = handoff.offer
  handoff.offer = null
  if (!offer) return false
  const there = connect.devices.find((d) => d.id === offer.device && d.online && !d.me)
  if (there) { await bringHere(offer.device); return true }
  return startSession(offer.session, true)
}
