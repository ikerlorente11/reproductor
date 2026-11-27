/**
 * What one keeps in one's library without downloading it: the artists one follows, the albums and the Deezer playlists
 * one saves. They show in «Tu biblioteca» and play straight from YouTube Music (an app that can); downloading them is
 * another thing (an artist's «Descargar», an album's «Bajar»).
 *
 * Kept on this device (so it works without a server) and, with a server connected, the same on every device: each item
 * keeps when it last changed, and the latest change of each wins; one taken out stays as taken out (`gone`) so the other
 * devices take it out too.
 */
import { computed, reactive, ref, watch } from 'vue'
import type { Api } from './api.ts'

export type SavedKind = 'artist' | 'album' | 'dzlist'
export interface Saved {
  kind: SavedKind
  /** its Deezer id */
  id: number
  name: string
  /** what goes under it (an album's artist, a list's songs) */
  note?: string
  picture?: string | null
  /** when it last changed (seconds since 1970) */
  updated: number
  /** taken out of the library */
  gone?: boolean
}

const KEY = 'reproductor.saved'
/** taken out more than this long ago, forgotten (every device has heard of it by then) */
const GONE_FOR = 180 * 86400
const keyOf = (kind: SavedKind, id: number) => `${kind}:${id}`

const store = reactive<{ items: Record<string, Saved> }>({ items: {} })
try {
  const kept = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Saved>
  const old = Date.now() / 1000 - GONE_FOR
  for (const [k, v] of Object.entries(kept)) if (!(v.gone && v.updated < old)) store.items[k] = v
} catch (_) {}
watch(() => store.items, (items) => { try { localStorage.setItem(KEY, JSON.stringify(items)) } catch (_) {} }, { deep: true })

/** Whether it is in the library. */
export function isSaved(kind: SavedKind, id: number): boolean {
  const it = store.items[keyOf(kind, id)]
  return !!it && !it.gone
}
/** What of a kind is in the library, the latest first. */
export function savedOf(kind: SavedKind): Saved[] {
  return Object.values(store.items).filter((x) => x.kind === kind && !x.gone).sort((a, b) => b.updated - a.updated)
}
export const savedArtists = computed(() => savedOf('artist'))
export const savedAlbums = computed(() => savedOf('album'))
export const savedLists = computed(() => savedOf('dzlist'))

/** Puts it in the library (or takes it out). */
export function setSaved(kind: SavedKind, id: number, on: boolean, info: { name: string; note?: string; picture?: string | null }) {
  const k = keyOf(kind, id)
  const now = Date.now() / 1000
  store.items[k] = { ...(store.items[k] || {}), kind, id, name: info.name, note: info.note, picture: info.picture ?? null, updated: Math.max(now, (store.items[k]?.updated || 0) + 0.001), gone: !on }
  changed.add(k)
  scheduleSend()
}
export function toggleSaved(kind: SavedKind, id: number, info: { name: string; note?: string; picture?: string | null }): boolean {
  const on = !isSaved(kind, id)
  setSaved(kind, id, on, info)
  return on
}

// ---- with a server: the same on every device ----
let api: Api | null = null
/** changed here and not sent yet */
const changed = new Set<string>()
let sendTimer: ReturnType<typeof setTimeout> | null = null
let lastAsked = 0
const stops: (() => void)[] = []
/** being shared now */
export const savedShared = ref(false)

const toServer = (x: Saved) => ({ kind: x.kind, id: x.id, updated: x.updated, gone: !!x.gone, data: { name: x.name, note: x.note, picture: x.picture } })
/** Takes what the server says where it is newer than what is here. */
function merge(rows: { kind: SavedKind; id: number; data: any; updated: number; gone: boolean }[]) {
  for (const r of rows) {
    const k = keyOf(r.kind, r.id)
    const here = store.items[k]
    if (here && here.updated >= r.updated) continue
    store.items[k] = { kind: r.kind, id: r.id, name: r.data?.name || here?.name || '', note: r.data?.note, picture: r.data?.picture ?? null, updated: r.updated, gone: r.gone }
    changed.delete(k)
  }
}
function scheduleSend() {
  if (!api) return
  if (sendTimer) clearTimeout(sendTimer)
  sendTimer = setTimeout(send, 1000)
}
async function send() {
  if (!api || !changed.size) return
  const keys = [...changed]
  const items = keys.map((k) => store.items[k]).filter(Boolean).map(toServer)
  try {
    const rows = await api.putSaved(items)
    keys.forEach((k) => changed.delete(k))
    merge(rows)
  } catch (_) { /* sent again with the next change, or on coming back */ }
}
/** The server's: what is newer there, taken; what is newer here (or only here), sent. */
async function sync() {
  if (!api) return
  lastAsked = Date.now()
  try {
    const rows = await api.saved()
    merge(rows)
    const there = new Map(rows.map((r) => [keyOf(r.kind, r.id), r.updated]))
    for (const [k, v] of Object.entries(store.items)) if ((there.get(k) ?? -1) < v.updated) changed.add(k)
    await send()
  } catch (_) {}
}

/** Starts sharing the library with the server (connected); gives back how to stop. */
export function startSaved(server: Api): () => void {
  stopSaved()
  api = server
  savedShared.value = true
  if (typeof document !== 'undefined') {
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastAsked > 30000) sync() }
    document.addEventListener('visibilitychange', onVisible)
    stops.push(() => document.removeEventListener('visibilitychange', onVisible))
  }
  sync()
  return stopSaved
}
export function stopSaved() {
  if (sendTimer) { clearTimeout(sendTimer); sendTimer = null }
  stops.splice(0).forEach((s) => s())
  api = null
  savedShared.value = false
}
