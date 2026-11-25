<template>
  <ReproductorShell :key="mode" :api="server?.api" :sl="server?.sl" :files="files" :device="device" :engine="null"
                    :offline="server ? offline : null" :view="view" :navigate="navigate" music-root="Música"
                    :cloud-name="server ? server.connection.name || 'tu nube' : 'Android'" :me="server ? me : undefined"
                    :where="server ? 'tu nube' : undefined">
    <template #settings>
      <SettingsView :device="device" :libraries="remotes" :version="version" :server="server?.connection || null" :server-error="serverError"
                    :saved="savedServer" :connect="connectServer" :disconnect="disconnectServer" :allowed="allowed" />
    </template>
  </ReproductorShell>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import {
  DeviceLibrary, Offline, RemoteLibraries, ReproductorShell, withRemotes, deviceId, play, queryFromView, setOutput, viewFromQuery,
  type Files, type Me, type View
} from 'reproductor-player'
import 'reproductor-player/ui.css'
import { androidDevice, androidOffline, cloud, hostFetch, info, nativeOutput, openUri, secrets, tellApp } from './lib/host'
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
const mode = computed(() => (server.value ? 'server' : 'device'))
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
    try { await cloud.remove(path) } catch (err) { throw failed(err) }
  },
  async play(song) {
    if (song.device) return { url: device.backend.fileUrl(song.device) }
    return { url: cloud.url(song.path) }
  }
}

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
    if (about.device) me.name = `Android · ${about.device}`
  }
  await device.start().catch((err) => { device.state.error = String(err?.message || err) })
  remotes.start()
  tellApp({ type: 'ready' })
  // the server saved, if any
  const saved = await savedConnection().catch(() => null)
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
