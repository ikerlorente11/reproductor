// A stand-in for the app's native host (HostServer.kt), only for the store's screenshots: it serves the built page
// and a phone's music from a folder (make_demo.py), so the page can be shot in a desktop browser at phone size.
//   node mock-host.mjs <web dir> <music dir> [port]
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, existsSync, createReadStream } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { execFileSync } from 'node:child_process'

const [, , WEB, MUSIC, PORT = '48143'] = process.argv
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.mp3': 'audio/mpeg', '.webp': 'image/webp' }

// ---- the library: tags read once with ffprobe ----
const tracks = []
const covers = {}
const files = {}
const now = Math.floor(Date.now() / 1000)
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { walk(p); continue }
    if (extname(p) !== '.mp3') continue
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', p]).toString())
    const t = Object.fromEntries(Object.entries(info.format.tags || {}).map(([k, v]) => [k.toLowerCase(), v]))
    const rel = relative(MUSIC, p).replaceAll('\\', '/')
    const id = createHash('md5').update(rel).digest('hex').slice(0, 16)
    const coverFile = join(dir, 'cover.jpg')
    const cover = existsSync(coverFile) ? createHash('md5').update(coverFile).digest('hex').slice(0, 12) : null
    if (cover) covers[cover] = coverFile
    files[id] = p
    const order = tracks.length
    tracks.push({
      id, path: `/storage/emulated/0/Music/${rel}`, size: statSync(p).size, mtime: now - 86400 * 30, title: t.title,
      artist: t.artist, album_artist: t.album_artist || t.artist, album: t.album, track: parseInt(t.track) || 0, disc: 1,
      year: parseInt(t.date) || 0, genre: t.genre || '', duration: Math.round(parseFloat(info.format.duration)), cover,
      // the newest albums first in «Añadido hace poco»
      added: now - 3600 * (1 + Math.floor(order / 6) * 20)
    })
  }
}
walk(MUSIC)
console.log(tracks.length, 'canciones')

// ---- events (SSE) and the «native» player ----
const clients = new Set()
const send = (e) => { for (const res of clients) res.write(`data: ${JSON.stringify(e)}\n\n`) }
const audio = { loaded: false, key: null, t: 0, d: 0, playing: false }
let ticker = null
const prefs = {}
const secrets = {}

function body(req) {
  return new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}) } catch (_) { ok({}) } }) })
}
function json(res, v, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(v === undefined ? '' : JSON.stringify(v))
}
function file(res, p, req) {
  if (!p || !existsSync(p)) { res.writeHead(404); return res.end() }
  const size = statSync(p).size
  const type = TYPES[extname(p)] || 'application/octet-stream'
  const range = req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range)
  if (range) {
    const start = +range[1]
    const end = range[2] ? +range[2] : size - 1
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 })
    return createReadStream(p, { start, end }).pipe(res)
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' })
  createReadStream(p).pipe(res)
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const path = decodeURIComponent(url.pathname)
  const m = req.method
  if (path === '/host/info') return json(res, { version: '0.1.0', device: 'Pixel 8', library: true, music: '/storage/emulated/0/Music/El Reproductor' })
  if (path === '/host/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(': hola\n\n')
    clients.add(res)
    return req.on('close', () => clients.delete(res))
  }
  if (path === '/host/prefs') {
    if (m === 'PUT') Object.assign(prefs, await body(req))
    for (const k of Object.keys(prefs)) if (prefs[k] === null) delete prefs[k]
    return json(res, prefs)
  }
  if (path === '/host/secret') {
    const key = url.searchParams.get('key')
    if (m === 'PUT') { secrets[key] = (await body(req)).value; return json(res) }
    if (m === 'DELETE') { delete secrets[key]; return json(res) }
    return json(res, { value: secrets[key] ?? null })
  }
  if (path === '/host/library') return json(res, { roots: ['/storage/emulated/0/Music'], tracks, scanning: false })
  if (path.startsWith('/host/library/')) return json(res, path.endsWith('show') ? { shown: false } : undefined)
  if (path.startsWith('/host/offline/')) return json(res, path.endsWith('have') ? [] : undefined)
  if (path.startsWith('/host/cloud')) return json(res, { detail: 'sin nube' }, 404)
  if (path === '/host/fetch') return json(res, { detail: 'sin red en la demo' }, 502)
  if (path === '/host/audio') {
    const b = await body(req)
    switch (b.op) {
      case 'load': {
        const it = b.items[b.index] || {}
        Object.assign(audio, { loaded: true, key: it.key ?? null, t: b.from || 0, d: 0, playing: false })
        const tr = tracks.find((x) => it.url && it.url.includes(`/f/${x.id}`))
        audio.d = tr ? tr.duration : 200
        send({ type: 'audio', ev: 'duration', d: audio.d })
      }
      // falls through: loading starts the sound, as Playback.kt does
      case 'play':
        audio.playing = true
        send({ type: 'audio', ev: 'play' })
        clearInterval(ticker)
        ticker = setInterval(() => { audio.t += 1; send({ type: 'audio', ev: 'time', t: audio.t }) }, 1000)
        break
      case 'pause': audio.playing = false; clearInterval(ticker); send({ type: 'audio', ev: 'pause', t: audio.t }); break
      case 'seek': audio.t = b.t; send({ type: 'audio', ev: 'time', t: audio.t }); break
      case 'clear': audio.loaded = false; clearInterval(ticker); break
    }
    return json(res, { loaded: audio.loaded, key: audio.key, t: audio.t, d: audio.d, playing: audio.playing })
  }
  if (path.startsWith('/f/')) return file(res, files[path.slice(3)], req)
  if (path.startsWith('/c/')) return file(res, covers[path.slice(3)], req)
  if (path.startsWith('/l/')) { res.writeHead(404); return res.end() }
  if (path.startsWith('/w/')) { res.writeHead(404); return res.end() }
  // the page
  const p = join(WEB, path === '/' ? 'index.html' : path)
  return file(res, existsSync(p) && statSync(p).isFile() ? p : join(WEB, 'index.html'), req)
}).listen(+PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}/?t=demo`))
