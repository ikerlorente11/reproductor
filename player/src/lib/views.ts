/** The pages of the app and how each is written in the route's query (pure, for tests too). */

export type View =
  | { v: 'home' }
  | { v: 'search'; q?: string; tab?: string }
  | { v: 'artist'; id: number }
  | { v: 'release'; id: number }
  | { v: 'folder'; path: string }
  | { v: 'playlist'; id: number }
  | { v: 'dzlist'; id: number }
  | { v: 'downloads' }
  | { v: 'soundlift' }
  | { v: 'spotify' }
  // the music of this device, and what is yours on it
  | { v: 'songs' }
  | { v: 'albums' }
  | { v: 'artists' }
  | { v: 'lalbum'; key: string }
  | { v: 'lartist'; name: string }
  | { v: 'lfolder'; path: string }
  | { v: 'llist'; id: string }
  | { v: 'likes' }
  | { v: 'recent' }
  | { v: 'settings' }

const BARE = ['downloads', 'soundlift', 'spotify', 'songs', 'albums', 'artists', 'likes', 'recent', 'settings'] as const

/** The view a route's query stands for (the app keeps its place in the URL). */
export function viewFromQuery(query: Record<string, unknown>): View {
  const v = String(query.v || 'home')
  const id = Number(query.id)
  if (v === 'search') return query.tab ? { v, q: String(query.q || ''), tab: String(query.tab) } : { v, q: String(query.q || '') }
  if ((v === 'artist' || v === 'release' || v === 'playlist' || v === 'dzlist') && id > 0) return { v, id }
  if ((v === 'folder' || v === 'lfolder') && query.path) return { v, path: String(query.path) }
  if (v === 'lalbum' && query.key) return { v, key: String(query.key) }
  if (v === 'lartist' && query.name) return { v, name: String(query.name) }
  if (v === 'llist' && query.id) return { v, id: String(query.id) }
  if ((BARE as readonly string[]).includes(v)) return { v } as View
  return { v: 'home' }
}
export function queryFromView(view: View): Record<string, string> {
  if (view.v === 'home') return {}
  if (view.v === 'search') return { v: 'search', ...(view.q ? { q: view.q } : {}), ...(view.tab ? { tab: view.tab } : {}) }
  if (view.v === 'folder' || view.v === 'lfolder') return { v: view.v, path: view.path }
  if (view.v === 'lalbum') return { v: view.v, key: view.key }
  if (view.v === 'lartist') return { v: view.v, name: view.name }
  if ('id' in view) return { v: view.v, id: String(view.id) }
  return { v: view.v }
}
