/**
 * Playing a whole list or artist at once (Inicio's cells, the desktop's mini player): its songs, whatever it is (a
 * playlist of the server, one of this device, Me gusta, an artist of the cloud or of this device), and the play counted
 * for it.
 */
import type { Api } from './api.ts'
import type { DeviceLibrary } from './device.ts'
import { playlistSongs, releaseSongs, type Song } from './library.ts'
import { mine, type PlaySource } from './mine.ts'
import { play } from './player.ts'
import type { View } from './views.ts'

/** The songs of a list's or an artist's page (an artist's: downloaded ones, oldest release first). */
export async function songsOf(v: View, api: Api | undefined, device: DeviceLibrary | null): Promise<Song[]> {
  if (v.v === 'playlist' && api) return playlistSongs((await api.playlist(v.id)).songs)
  if (v.v === 'llist') return mine.lists.find((l) => l.id === v.id)?.songs || []
  if (v.v === 'likes') return mine.likes.map((l) => l.song)
  if (v.v === 'artist' && api) {
    const page = await api.artist(v.id, true)
    return page.releases.filter((r) => r.status === 'done').sort((a, b) => (a.date || '').localeCompare(b.date || '')).flatMap(releaseSongs)
  }
  if (v.v === 'lartist' && device) {
    const a = device.artists.find((x) => x.name === v.name)
    return a ? device.songs(a.tracks) : []
  }
  return []
}

/** What a list's plays count for in «Lo que más escuchas» (its key there); null for a page that is not a list. */
export function listKey(v: View): string | null {
  if (v.v === 'playlist') return `playlist:${v.id}`
  if (v.v === 'llist') return `llist:${v.id}`
  if (v.v === 'likes') return 'likes'
  return null
}

/** Plays it all (shuffled or not, as the player is), counted for it if it is a list; false when it has nothing. */
export async function playAll(v: View, name: string, api: Api | undefined, device: DeviceLibrary | null): Promise<boolean> {
  const songs = await songsOf(v, api, device)
  if (!songs.length) return false
  const key = listKey(v)
  const source: PlaySource | null = key ? { kind: 'list', key, name, view: v } : null
  play(songs, null, undefined, source)
  return true
}
