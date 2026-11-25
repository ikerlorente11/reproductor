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

/** The view a route's query stands for (the app keeps its place in the URL). */
export function viewFromQuery(query: Record<string, unknown>): View {
  const v = String(query.v || 'home')
  const id = Number(query.id)
  if (v === 'search') return query.tab ? { v, q: String(query.q || ''), tab: String(query.tab) } : { v, q: String(query.q || '') }
  if ((v === 'artist' || v === 'release' || v === 'playlist' || v === 'dzlist') && id > 0) return { v, id }
  if (v === 'folder' && query.path) return { v, path: String(query.path) }
  if (v === 'downloads' || v === 'soundlift' || v === 'spotify') return { v }
  return { v: 'home' }
}
export function queryFromView(view: View): Record<string, string> {
  if (view.v === 'home') return {}
  if (view.v === 'search') return { v: 'search', ...(view.q ? { q: view.q } : {}), ...(view.tab ? { tab: view.tab } : {}) }
  if (view.v === 'folder') return { v: 'folder', path: view.path }
  if (view.v === 'downloads' || view.v === 'soundlift' || view.v === 'spotify') return { v: view.v }
  return { v: view.v, id: String(view.id) }
}
