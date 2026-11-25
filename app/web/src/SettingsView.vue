<template>
  <section class="rp-page ra-settings">
    <header class="rp-page-head"><h1 class="rp-h1">Ajustes</h1></header>

    <section class="ra-box">
      <h2>Música del móvil</h2>
      <template v-if="!allowed">
        <p class="rp-muted rp-small">El Reproductor necesita permiso para leer la música de este móvil.</p>
        <div class="ra-actions"><button class="rp-btn rp-primary" @click="ask">Dar permiso</button></div>
        <p class="rp-muted rp-tiny">Si Android ya no lo pregunta: Ajustes de Android › Aplicaciones › El Reproductor › Permisos › Música y audio.</p>
      </template>
      <template v-else>
        <p class="rp-muted rp-small">Toda la música que Android tiene en el móvil, por carpetas. Puedes quitar las que no quieras ver.</p>
        <ul v-if="localRoots.length" class="ra-roots">
          <li v-for="r in localRoots" :key="r">
            <i class="rp-i rp-i-folder" aria-hidden="true"></i>
            <span class="rp-ellipsis" :title="r">{{ short(r) }}</span>
            <span class="rp-muted rp-small">{{ countIn(r) }}</span>
            <button class="rp-mini" title="No ver esta carpeta (no se borra nada)" @click="remove(r)"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
          </li>
        </ul>
        <p v-else-if="lib.loaded" class="rp-muted">No hay música en el móvil.</p>
        <div class="ra-actions">
          <button class="rp-btn" :disabled="lib.scanning" @click="device.backend.scan()">
            <span v-if="lib.scanning" class="rp-spin"></span><i v-else class="rp-i rp-i-refresh" aria-hidden="true"></i> Volver a leer
          </button>
          <button class="rp-btn" @click="showAll">Ver las carpetas quitadas</button>
          <span class="rp-muted rp-small">{{ lib.tracks.length }} canciones · {{ device.albums.length }} discos · {{ device.artists.length }} artistas</span>
        </div>
        <p v-if="lib.error" class="rp-banner rp-banner-error">{{ lib.error }}</p>
      </template>
    </section>

    <section class="ra-box"><LibrariesSettings :libraries="libraries" /></section>

    <section class="ra-box">
      <h2>Servidor</h2>
      <template v-if="server">
        <p>Conectado a <strong>{{ server.name || server.url }}</strong> como <strong>{{ server.username }}</strong>.</p>
        <p class="rp-muted rp-small">Ves la música de tu nube, lo que bajas va a ella y este móvil es uno más de tus dispositivos.</p>
        <div class="ra-actions"><button class="rp-btn" :disabled="busy" @click="leave">Desconectar</button></div>
      </template>
      <form v-else class="ra-form" @submit.prevent="join">
        <p class="rp-muted rp-small">Conecta un servidor de El Reproductor (el de tu Archivador) para ver toda la música de tu nube, bajar a ella y
          seguir escuchando en otros dispositivos.</p>
        <label>Dirección<input v-model.trim="form.url" class="rp-input" placeholder="https://elreproductor.ejemplo.com" inputmode="url" autocapitalize="off" required /></label>
        <label>Usuario<input v-model.trim="form.username" class="rp-input" autocomplete="username" autocapitalize="off" required /></label>
        <label>Contraseña<input v-model="form.password" class="rp-input" type="password" autocomplete="current-password" required /></label>
        <label>Nombre <small class="rp-muted">(opcional)</small><input v-model.trim="form.name" class="rp-input" placeholder="El Archivador" /></label>
        <p class="rp-muted rp-tiny">La de tu cuenta de la nube. La app la usa una sola vez para crearse su propia contraseña de aplicación, que es la
          única que guarda (cifrada en el móvil). Puedes quitársela desde tu nube cuando quieras.</p>
        <div class="ra-actions"><button class="rp-btn rp-primary" :disabled="busy"><span v-if="busy" class="rp-spin"></span> Conectar</button></div>
      </form>
      <p v-if="error || serverError" class="rp-banner rp-banner-error">{{ error || serverError }}</p>
    </section>

    <section class="ra-box">
      <h2>El Reproductor</h2>
      <p class="rp-muted rp-small">Versión {{ version || '—' }}.</p>
      <h3 class="ra-news-h">Novedades de la 0.1.0</h3>
      <ul class="ra-news">
        <li>La música del móvil, por artistas, discos y carpetas, con sus portadas y sus letras (de un .lrc o de LRCLIB).</li>
        <li>Sigue sonando con la pantalla apagada, con sus botones en la notificación, la pantalla de bloqueo y los auriculares.</li>
        <li>Conecta tu servidor de El Reproductor y verás toda la música de tu nube; guarda discos y listas en el móvil para escucharlos sin conexión.</li>
        <li>Este móvil es uno más de tus dispositivos: pásale lo que suena en el ordenador o en la web, o llévatelo de aquí.</li>
        <li>Bibliotecas: añade tu Navidrome (o cualquier servidor Subsonic) o tu Jellyfin.</li>
      </ul>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { LibrariesSettings, type DeviceLibrary, type RemoteLibraries } from 'reproductor-player'
import { tellApp } from './lib/host'
import type { Connection } from './lib/server'

const props = defineProps<{
  device: DeviceLibrary
  libraries: RemoteLibraries
  version: string
  server: Connection | null
  serverError: string
  saved?: Connection | null
  connect: (c: Connection, password: string) => Promise<void>
  disconnect: () => Promise<void>
  /** the permission to read the music was given */
  allowed: boolean
}>()
const form = reactive({ url: props.saved?.url || '', username: props.saved?.username || '', password: '', name: props.saved?.name || '' })
const busy = ref(false)
const error = ref('')
async function join() {
  busy.value = true
  error.value = ''
  try {
    if (!/^https?:\/\//i.test(form.url)) form.url = `https://${form.url}`
    await props.connect({ url: form.url, username: form.username, name: form.name }, form.password)
    form.password = ''
  } catch (err: any) { error.value = `No se pudo conectar: ${err?.message || err}` } finally { busy.value = false }
}
async function leave() {
  if (!window.confirm('¿Desconectar el servidor? La música de tu nube deja de verse aquí; no se borra nada.')) return
  busy.value = true
  try { await props.disconnect() } finally { busy.value = false }
}
const lib = props.device.state
/** the phone's folders (the libraries' are in Bibliotecas) */
const localRoots = computed(() => lib.roots.filter((r) => r.startsWith('/')))
const short = (root: string) => root.replace(/^\/storage\/emulated\/\d+\/?/, 'Memoria interna/').replace(/^\/storage\/([^/]+)\/?/, 'Tarjeta $1/').replace(/\/$/, '') || root
const countIn = (root: string) => { const n = lib.tracks.filter((t) => t.path.startsWith(root + '/')).length; return `${n} ${n === 1 ? 'canción' : 'canciones'}` }
const ask = () => tellApp({ type: 'permission' })
async function remove(root: string) {
  if (!window.confirm(`¿Dejar de ver «${short(root)}»? Sus canciones salen de El Reproductor, pero no se borra ningún archivo.`)) return
  await props.device.backend.removeRoot(root)
}
async function showAll() { await props.device.backend.addRoot() }
</script>
