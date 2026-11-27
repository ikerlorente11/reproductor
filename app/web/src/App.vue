<template>
  <ReproductorShell :key="mode" :api="server?.api || pocket || undefined" :sl="server?.sl" :files="files" :device="device" :engine="null"
                    :offline="server ? offline : null" :view="view" :navigate="navigate" music-root="Música"
                    :cloud-name="server ? server.connection.name || 'tu nube' : 'Android'" :me="server ? me : undefined"
                    :where="server ? 'tu nube' : pocket ? 'este teléfono' : undefined" :open-fetch="hostFetch">
    <template #settings>
      <SettingsView :device="device" :libraries="remotes" :version="version" :server="server?.connection || null" :server-error="serverError"
                    :saved="savedServer" :connect="connectServer" :disconnect="disconnectServer" :allowed="allowed" />
    </template>
  </ReproductorShell>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import {
  DeviceLibrary, Offline, RemoteLibraries, ReproductorShell, withRemotes, deviceId, play, pocketApi, queryFromView, setOutput, viewFromQuery,
  type Api, type Files, type Me, type PocketSong, type View
} from 'reproductor-player'
import 'reproductor-player/ui.css'
import { androidDevice, androidOffline, cloud, host, hostFetch, hostUrl, info, nativeOutput, openUri, secrets, tellApp } from './lib/host'
import { connect, disconnect, savedConnection, type Connection, type Server } from './lib/server'
import SettingsView from './SettingsView.vue'

/**
 * El Reproductor for Android: the shared app (reproductor-player) over the music of this phone (Android's media index,
 * read by the host) and, connected to a server of El Reproductor (Ajustes › Servidor), that server's El Reproductor:
 * the cloud's music, its downloads, its playlists, and this phone is one of the person's devices. The sound is
 * Android's own player (nativeOutput): it goes on with the screen off and shows in the notification and the lock screen.
 * Where the app is lives in the hash (#v=album&…), so the back button goes back.
 */
setOutput(nativeOutput)

/** the person's music servers (Subsonic, Jellyfin; Ajustes › Bibliotecas), their passwords in the app's secrets */
const remotes = new RemoteLibraries({
  get: (key) => secrets.get(`player:${key}`),
  set: (key, value) => secrets.set(`player:${key}`, value),
  delete: (key) => secrets.delete(`player:${key}`)
}, hostFetch, 'El Reproductor (Android)')
/** this phone's music, and the libraries' joined to it (each one more folder) */
const device = new DeviceLibrary(withRemotes(androidDevice(), remotes))
/** songs of the cloud kept on this phone */
const offline = new Offline(androidOffline())
const version = ref('')
const allowed = ref(true)

// ---- a server of its own (El Archivador's El Reproductor) ----
const server = shallowRef<Server | null>(null)
const serverError = ref('')
const savedServer = ref<Connection | null>(null)
/** without a server: the catalogue's pages answered in the app itself (pocket.ts), when the installed app can play
 *  from YouTube Music (and download to the phone, if it knows how) */
const pocket = shallowRef<Api | null>(null)
const mode = computed(() => (server.value ? 'server' : pocket.value ? 'pocket' : 'device'))
/** This phone among the person's devices (once connected to a server): «Android · Pixel 8». */
const me = reactive<Me>({ id: deviceId(), name: 'Android', kind: 'android' })
async function connectServer(c: Connection, password: string) {
  server.value = await connect(c, password, me.name)
  serverError.value = ''
}
async function disconnectServer() {
  if (server.value) await disconnect(server.value.connection)
  server.value = null
}

/** A missing folder or file: the pages expect `status: 404`. */
const failed = (err: any) => Object.assign(err instanceof Error ? err : new Error(String(err)), { status: err?.status === 404 ? 404 : err?.status })
/** The songs: this phone's by their id in the index; the server's by their path in its cloud (through the host). */
const files: Files = {
  async list(dir) {
    try { return await cloud.list(dir) } catch (err) { throw failed(err) }
  },
  async remove(path) {
    // a song downloaded without a server: out of the phone's music
    if (path.startsWith('pocket:')) return void await host('/host/dl/remove', { method: 'POST', body: JSON.stringify({ paths: [path] }) })
    try { await cloud.remove(path) } catch (err) { throw failed(err) }
  },
  async play(song) {
    if (song.device) return { url: device.backend.fileUrl(song.device) }
    if (song.path.startsWith('pocket:')) return { url: hostUrl(`/p/${song.path.slice('pocket:'.length)}`) }
    // a song one does not have: the app's host finds it on YouTube Music and relays its audio (Yt.kt)
    if (song.stream) {
      const q = new URLSearchParams({ artist: song.stream.artist, title: song.stream.title, d: String(Math.round(song.stream.duration || 0)),
                                      ...(song.stream.isrc ? { isrc: song.stream.isrc } : {}) })
      return { url: hostUrl(`/host/yt/q?${q}`) }
    }
    return { url: cloud.url(song.path) }
  },
  // only if the installed app knows how (one older than this page does not)
  get stream() { return canStream.value },
  prepare(songs) {
    const wanted = songs.filter((s) => s.stream).map((s) => ({ artist: s.stream!.artist, title: s.stream!.title, d: s.stream!.duration || 0, isrc: s.stream!.isrc || '' }))
    if (wanted.length && canStream.value) host('/host/yt/prepare', { method: 'POST', body: JSON.stringify({ songs: wanted }) }).catch(() => {})
  }
}
/** the app's host can play songs from YouTube Music (it says so in /host/info) */
const canStream = ref(false)

const readHash = (): View => viewFromQuery(Object.fromEntries(new URLSearchParams(location.hash.replace(/^#/, ''))))
const view = ref<View>(readHash())
function navigate(next: View, replace = false) {
  const hash = '#' + new URLSearchParams(queryFromView(next)).toString()
  if (replace) history.replaceState(null, '', hash)
  else if (hash !== location.hash) history.pushState(null, '', hash)
  view.value = next
}
const onPop = () => { view.value = readHash() }

/** Links meant for a new tab (a song on YouTube, a source's page) open in the system's browser. */
function onLink(e: MouseEvent) {
  const a = (e.target as HTMLElement)?.closest?.('a[target="_blank"]') as HTMLAnchorElement | null
  if (!a || !/^https?:/.test(a.href)) return
  e.preventDefault()
  tellApp({ type: 'open-url', url: a.href })
}

/** A song another app opened with El Reproductor: on its own, or with the rest of its album when it is in the library. */
async function playUri(uri: string) {
  try {
    const track = await openUri(uri)
    const album = device.album(device.song(track).albumKey || '')
    const songs = album?.tracks.some((t) => t.id === track.id) ? device.songs(album.tracks) : [device.song(track)]
    play(songs, songs.find((s) => s.device === track.id) || songs[0], false)
  } catch (err: any) {
    console.error(err)
  }
}

onMounted(async () => {
  window.addEventListener('popstate', onPop)
  document.addEventListener('click', onLink, true)
  ;(window as any).__reproductorOpen = (uri: string) => playUri(uri)
  // the player over the whole screen paints the status bar in the colour of its cover
  window.addEventListener('reproductor:top', (e) => tellApp({ type: 'top', color: (e as CustomEvent).detail ?? null }))
  const about = await info().catch(() => null)
  if (about) {
    version.value = about.version
    allowed.value = about.library
    canStream.value = !!about.features?.includes('yt')
    if (canStream.value) {
      const downloads = about.features?.includes('dl') ? {
        download: (song: PocketSong) => host<{ path: string }>('/host/dl/song', { method: 'POST', body: JSON.stringify(song) }),
        remove: async (paths: string[]) => { await host('/host/dl/remove', { method: 'POST', body: JSON.stringify({ paths }) }) }
      } : null
      pocket.value = pocketApi(hostFetch, downloads)
    }
    if (about.device) me.name = `Android · ${about.device}`
  }
  await device.start().catch((err) => { device.state.error = String(err?.message || err) })
  remotes.start()
  tellApp({ type: 'ready' })
  // the server saved, if any (while developing, `?pocket` tries the app without it, leaving it saved)
  const saved = import.meta.env.DEV && new URLSearchParams(location.search).has('pocket') ? null : await savedConnection().catch(() => null)
  if (saved) {
    try { server.value = await connect(saved, undefined, me.name) } catch (err: any) {
      serverError.value = `No se pudo conectar con ${saved.url}: ${err?.message || err}`
      savedServer.value = saved
    }
  }
})
// the permission given later (the library reads it then): Ajustes stops asking for it
device.backend.onChanged((error) => { allowed.value = !error || !/permiso/.test(error) })
device.backend.onProgress((p) => { if (p.done > 0) allowed.value = true })
onBeforeUnmount(() => {
  window.removeEventListener('popstate', onPop)
  document.removeEventListener('click', onLink, true)
})
</script>
