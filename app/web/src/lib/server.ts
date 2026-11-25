/** A server of El Reproductor of its own (El Archivador's), as on the desktop (pc-toolkit's lib/server.ts): its address,
 *  user and name in the app's settings, the app password in its encrypted secrets (through the host). The person types
 *  their normal password once: the app makes with it an app password of its own in the cloud, keeps only that one and
 *  forgets theirs. Connected, the app is the server's El Reproductor: the cloud's music (played through the host), its
 *  downloads, its playlists, and this phone is one of the person's devices. */
import { Api, Soundlift } from 'reproductor-player'
import { cloud, hostFetch, prefs, secrets } from './host'

export interface Connection {
  url: string
  username: string
  /** what the person called it */
  name: string
}

export interface Server {
  connection: Connection
  api: Api
  sl: Soundlift
}

export async function savedConnection(): Promise<Connection | null> {
  const p = await prefs.all()
  const url = (p['server.url'] || '').replace(/\/+$/, '')
  const username = p['server.username'] || ''
  return url && username ? { url, username, name: p['server.name'] || '' } : null
}

const account = (c: Connection) => `server:${c.username}@${new URL(c.url).host}`

/** An app password of this app in the cloud (OpenCloud's /auth-app/tokens), made with the person's normal one. */
async function mintAppPassword(cloudUrl: string, username: string, password: string, device: string): Promise<string> {
  const q = new URLSearchParams({ label: `El Reproductor · ${device}`.slice(0, 100), expiry: '8760h' })
  let res: Response
  try {
    res = await hostFetch(`${cloudUrl}/auth-app/tokens?${q}`, { method: 'POST', headers: { Authorization: Api.basic(username, password)() } })
  } catch (err: any) {
    throw new Error(`no responde ${cloudUrl} (${err?.message || err})`)
  }
  if (res.status === 401) throw Object.assign(new Error('el usuario o la contraseña no son correctos'), { status: 401 })
  if (!res.ok) throw new Error(`tu nube no deja crear una contraseña para la app (HTTP ${res.status})`)
  const token = String((await res.json().catch(() => ({})))?.token || '').trim()
  if (!token) throw new Error('tu nube no devolvió la contraseña de la app')
  return token
}

/** Connects: asks the service who it is and where the cloud is, makes the app password (with `password`, the person's
 *  normal one, from Ajustes) and tells the host how to reach the cloud's songs. */
export async function connect(c: Connection, password: string | undefined, device: string): Promise<Server> {
  const url = c.url.trim().replace(/\/+$/, '')
  const connection = { ...c, url }
  let secret = password ?? ((await secrets.get(account(connection)).catch(() => null)) || '')
  if (!secret) throw Object.assign(new Error('vuelve a escribir tu contraseña'), { status: 401 })
  const fresh = password !== undefined
  let info: { name?: string; cloud?: string; webdav?: string; soundlift?: string | null }
  try {
    const res = await hostFetch(`${url}/api/info`)
    info = await res.json()
  } catch (err: any) {
    throw new Error(`no responde ${url} (${err?.message || err})`)
  }
  if (info.name !== 'reproductor' || !info.webdav) throw new Error('esa dirección no es un servidor de El Reproductor')
  if (fresh) secret = await mintAppPassword(info.cloud || info.webdav.replace(/\/remote\.php\/webdav$/, ''), connection.username, secret, device)
  const auth = Api.basic(connection.username, secret)
  const api = new Api(url, auth)
  api.fetch = hostFetch
  let status: { connected: boolean }
  try {
    status = await api.cloud()
  } catch (err: any) {
    // the app's password was revoked or ran out: the person writes theirs again
    throw Object.assign(new Error(err?.status === 401 ? 'tu sesión ha caducado: vuelve a escribir tu contraseña' : err?.message || String(err)),
                        { status: err?.status })
  }
  if (!status.connected) await api.connectCloud(secret)
  await cloud.set({ webdav: info.webdav, user: connection.username, password: secret })
  const sl = new Soundlift(info.soundlift || '', auth)
  sl.fetch = hostFetch
  if (fresh) {
    await prefs.set({ 'server.url': url, 'server.username': connection.username, 'server.name': connection.name.trim() })
    await secrets.set(account(connection), secret)   // only the app's: the person's is forgotten
  }
  return { connection, api, sl }
}

export async function disconnect(c: Connection): Promise<void> {
  await prefs.set({ 'server.url': null, 'server.username': null, 'server.name': null })
  await secrets.delete(account(c)).catch(() => {})
  await cloud.set(null)
}
