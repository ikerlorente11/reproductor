/**
 * What is yours on this device, whatever the music's source: the songs you like, your own playlists and what
 * you have listened to (with how many times). Each song is kept whole (title, artist, cover…), so these pages
 * play without asking anyone. Kept in this device's storage; with a server it also travels to the account.
 */
import { computed, reactive, watch } from 'vue'
import type { Song } from './library.ts'
import type { View } from './views.ts'

const LIKES = 'reproductor.likes'
const LISTS = 'reproductor.lists'
const HISTORY = 'reproductor.history'
const HISTORY_MAX = 500
const FAVORITES = 'reproductor.favorites'

export interface Liked { song: Song; at: number }
export interface DeviceList { id: string; name: string; created: number; updated: number; songs: Song[] }
export interface Played { song: Song; at: number }
/** Where a queue was started from: a list (its songs count for it; any other song counts for its artist). */
export interface PlaySource { kind: 'list'; key: string; name: string; view: View }
/** A list or an artist listened to, with how much lately (`score`, as of `at`: each play adds 1 and weighs half
 *  every FAVORITE_HALF_LIFE), so what is listened to now comes before what was listened to a lot long ago. */
export interface Favorite { key: string; kind: 'list' | 'artist'; name: string; view: View; score: number; at: number; plays: number; covers: string[] }

function read<T>(key: string, fallback: T): T {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback } catch (_) { return fallback }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch (_) { /* full or blocked: it stays for this session */ }
}

export const mine = reactive({
  likes: read<Liked[]>(LIKES, []),
  lists: read<DeviceList[]>(LISTS, []),
  history: read<Played[]>(HISTORY, []),
  /** times each song was listened to (by key), counted from the history and kept past it */
  counts: read<Record<string, number>>(`${HISTORY}.counts`, {}),
  /** the lists and artists listened to (by key), for «Lo que más escuchas» */
  favorites: read<Record<string, Favorite> | null>(FAVORITES, null) as Record<string, Favorite>
})
watch(() => mine.likes, (v) => write(LIKES, v), { deep: true })
watch(() => mine.lists, (v) => write(LISTS, v), { deep: true })
watch(() => mine.history, (v) => write(HISTORY, v), { deep: true })
watch(() => mine.counts, (v) => write(`${HISTORY}.counts`, v), { deep: true })
watch(() => mine.favorites, (v) => write(FAVORITES, v), { deep: true })

/** A song as kept here: what plays it and shows it, nothing that changes on its own. */
const keep = (s: Song): Song => JSON.parse(JSON.stringify(s))

// ---- likes ----
const likedKeys = computed(() => new Set(mine.likes.map((l) => l.song.key)))
export const isLiked = (song: Song | null | undefined) => !!song && likedKeys.value.has(song.key)
export function toggleLike(song: Song): boolean {
  const i = mine.likes.findIndex((l) => l.song.key === song.key)
  if (i >= 0) { mine.likes.splice(i, 1); return false }
  mine.likes.unshift({ song: keep(song), at: Date.now() })
  return true
}

// ---- playlists of this device ----
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
export function createList(name: string, songs: Song[] = []): DeviceList {
  const now = Date.now()
  const list: DeviceList = { id: newId(), name: name.trim() || 'Lista sin nombre', created: now, updated: now, songs: songs.map(keep) }
  mine.lists.push(list)
  return list
}
export const listById = (id: string) => mine.lists.find((l) => l.id === id)
export function renameList(id: string, name: string) {
  const l = listById(id)
  if (l && name.trim()) { l.name = name.trim(); l.updated = Date.now() }
}
export function deleteList(id: string) {
  const i = mine.lists.findIndex((l) => l.id === id)
  if (i >= 0) mine.lists.splice(i, 1)
}
/** Adds the songs not there yet, at the end; how many were added. */
export function addToList(id: string, songs: Song[]): number {
  const l = listById(id)
  if (!l) return 0
  const have = new Set(l.songs.map((s) => s.key))
  const fresh = songs.filter((s) => !have.has(s.key) && !!have.add(s.key))
  l.songs.push(...fresh.map(keep))
  if (fresh.length) l.updated = Date.now()
  return fresh.length
}
export function removeFromList(id: string, key: string) {
  const l = listById(id)
  if (!l) return
  l.songs = l.songs.filter((s) => s.key !== key)
  l.updated = Date.now()
}
export function moveInList(id: string, from: number, to: number) {
  const l = listById(id)
  if (!l || to < 0 || to >= l.songs.length) return
  const [s] = l.songs.splice(from, 1)
  l.songs.splice(to, 0, s)
  l.updated = Date.now()
}

// ---- what was listened to ----
/** A song counts as listened once it has played for a while (the player says when); `from`: where its queue came from. */
export function recordPlay(song: Song, from: PlaySource | null = null) {
  mine.history = [{ song: keep(song), at: Date.now() }, ...mine.history.filter((p, i) => i < HISTORY_MAX - 1)]
  mine.counts[song.key] = (mine.counts[song.key] || 0) + 1
  countFavorite(mine.favorites, song, from, Date.now())
  for (const fn of played) fn(keep(song))
}
const played = new Set<(song: Song) => void>()
/** Told of every song listened to (the server's history, connected); gives back how to stop. */
export function onPlayed(fn: (song: Song) => void): () => void {
  played.add(fn)
  return () => { played.delete(fn) }
}
/** The last songs listened to, each once (the latest time). */
export function recentSongs(limit = 50): Song[] {
  const seen = new Set<string>()
  const out: Song[] = []
  for (const p of mine.history) {
    if (seen.has(p.song.key)) continue
    seen.add(p.song.key)
    out.push(p.song)
    if (out.length >= limit) break
  }
  return out
}
/** The songs listened to most (of those still in the history), with their count. */
export function topSongs(limit = 50): { song: Song; count: number }[] {
  const songs = new Map<string, Song>()
  for (const p of mine.history) if (!songs.has(p.song.key)) songs.set(p.song.key, p.song)
  return [...songs.values()].map((song) => ({ song, count: mine.counts[song.key] || 1 }))
    .sort((a, b) => b.count - a.count).slice(0, limit)
}

// ---- what is listened to most: lists and artists ----
/** how long a play takes to weigh half */
export const FAVORITE_HALF_LIFE = 14 * 86400000
const FAVORITES_MAX = 300

/** What a song listened to counts for: the list it was played from, else its artist (none without one). */
export function favoriteOf(song: Song, from: PlaySource | null): Pick<Favorite, 'key' | 'kind' | 'name' | 'view'> | null {
  if (from?.kind === 'list') return { key: from.key, kind: 'list', name: from.name, view: from.view }
  const name = (song.device ? song.artistName || song.artist : song.artist || '').trim()
  if (song.artistId) return { key: `artist:${song.artistId}`, kind: 'artist', name, view: { v: 'artist', id: song.artistId } }
  if (!name) return null
  return song.device ? { key: `lartist:${name}`, kind: 'artist', name, view: { v: 'lartist', name } }
    : { key: `name:${name.toLowerCase()}`, kind: 'artist', name, view: { v: 'search', q: name } }
}
/** Its score at `now`. */
export const scoreAt = (f: Pick<Favorite, 'score' | 'at'>, now: number) => f.score * Math.pow(0.5, Math.max(0, now - f.at) / FAVORITE_HALF_LIFE)

/** Adds a play (at `at`) to what it counts for, in `all`. */
export function countFavorite(all: Record<string, Favorite>, song: Song, from: PlaySource | null, at: number) {
  const what = favoriteOf(song, from)
  if (!what) return
  const f = all[what.key] || { ...what, score: 0, at, plays: 0, covers: [] }
  f.score = scoreAt(f, at) + 1
  f.at = Math.max(f.at, at)
  f.plays++
  f.name = what.name || f.name
  if (song.cover && !f.covers.includes(song.cover) && f.covers.length < 4) f.covers.push(song.cover)
  all[what.key] = f
  const keys = Object.keys(all)
  if (keys.length > FAVORITES_MAX) {
    // the least listened go
    keys.sort((a, b) => scoreAt(all[a], at) - scoreAt(all[b], at)).slice(0, keys.length - FAVORITES_MAX).forEach((k) => delete all[k])
  }
}

/** The lists and artists listened to most lately (at least `min` of score), most first. */
export function topFavorites(all: Record<string, Favorite>, now = Date.now(), min = 1): Favorite[] {
  return Object.values(all).map((f) => ({ f, s: scoreAt(f, now) })).filter((x) => x.s >= min)
    .sort((a, b) => b.s - a.s).map((x) => x.f)
}

// Before lists were counted only the songs were: their artists start from the history kept.
if (!mine.favorites) {
  const all: Record<string, Favorite> = {}
  for (const p of [...mine.history].reverse()) countFavorite(all, p.song, null, p.at)
  mine.favorites = all
}
