<template>
  <section class="rp-panel rp-infopanel" aria-label="Información de la canción">
    <header class="rp-panel-head">
      <span class="rp-panel-title"><small class="rp-panel-kicker">Información</small><strong>{{ song?.title || 'Nada sonando' }}</strong></span>
      <button class="rp-mini" title="Cerrar" aria-label="Cerrar la información" @click="emit('close')"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
    </header>
    <div v-if="song" class="rp-panel-body">
      <p v-if="loading" class="rp-muted rp-small"><span class="rp-spin"></span> Buscando todo sobre ella…</p>

      <h3 class="rp-info-h">{{ artists.length === 1 ? 'Artista' : 'Artistas' }}</h3>
      <ul class="rp-info-artists">
        <li v-for="a in artists" :key="a.key">
          <component :is="a.view ? 'a' : 'span'" :href="a.view ? '#' : undefined" class="rp-info-artist" @click.prevent="a.view && open(a.view)">
            <img v-if="a.picture" :src="a.picture" alt="" loading="lazy" />
            <span v-else class="rp-info-artist-none"><i class="rp-i rp-i-artist" aria-hidden="true"></i></span>
            <span class="rp-info-artist-text">
              <strong class="rp-ellipsis">{{ a.name }}</strong>
              <small class="rp-muted">{{ a.role }}</small>
            </span>
          </component>
        </li>
      </ul>

      <h3 class="rp-info-h">Canción</h3>
      <dl class="rp-info-list">
        <template v-if="info?.version"><dt>Versión</dt><dd>{{ info.version }}</dd></template>
        <template v-if="duration"><dt>Duración</dt><dd>{{ duration }}</dd></template>
        <template v-if="info?.track_position"><dt>Pista</dt>
          <dd>{{ info.track_position }}<template v-if="info.album?.tracks"> de {{ info.album.tracks }}</template><template v-if="(info.disk_number || 1) > 1"> · disco {{ info.disk_number }}</template></dd></template>
        <template v-if="info?.date"><dt>Salió</dt><dd>{{ fmtDate(info.date) }}</dd></template>
        <template v-if="info?.bpm"><dt>Ritmo</dt><dd>{{ info.bpm }} BPM</dd></template>
        <template v-if="info?.explicit"><dt>Letra</dt><dd>Explícita</dd></template>
        <template v-if="plays"><dt>La has escuchado</dt><dd>{{ plays }} {{ plays === 1 ? 'vez' : 'veces' }} en este dispositivo</dd></template>
        <template v-if="info?.isrc"><dt>ISRC</dt><dd class="rp-info-code">{{ info.isrc }}</dd></template>
      </dl>

      <template v-if="info?.album || song.album">
        <h3 class="rp-info-h">Disco</h3>
        <dl class="rp-info-list">
          <dt>Título</dt>
          <dd><a v-if="albumView" href="#" @click.prevent="open(albumView)">{{ info?.album?.title || song.album }}</a><template v-else>{{ info?.album?.title || song.album }}</template></dd>
          <template v-if="info?.album?.artist_name"><dt>De</dt><dd>{{ info.album.artist_name }}</dd></template>
          <template v-if="info?.album?.kind"><dt>Tipo</dt><dd>{{ kindLabel(info.album.kind) }}</dd></template>
          <template v-if="info?.album?.date"><dt>Fecha</dt><dd>{{ fmtDate(info.album.date) }}</dd></template>
          <template v-if="info?.album?.label"><dt>Discográfica</dt><dd>{{ info.album.label }}</dd></template>
          <template v-if="info?.album?.genres?.length"><dt>Género</dt><dd>{{ info.album.genres.join(', ') }}</dd></template>
        </dl>
      </template>

      <h3 class="rp-info-h">Archivo</h3>
      <dl class="rp-info-list">
        <dt>Dónde está</dt><dd>{{ where }}</dd>
        <template v-if="format"><dt>Formato</dt><dd>{{ format }}</dd></template>
        <dt>Ruta</dt><dd class="rp-info-code">{{ song.path }}</dd>
      </dl>

      <p v-if="info && searched" class="rp-muted rp-small">Encontrada en Deezer por su título y su artista.</p>
      <p v-if="info?.link" class="rp-info-links">
        <a :href="info.link" target="_blank" rel="noopener" class="rp-btn rp-small">Abrir en Deezer</a>
      </p>
      <p v-else-if="failed" class="rp-muted rp-small">{{ failed }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SongInfo } from '../lib/api'
import { deezerSongInfo, plainName } from '../lib/deezer'
import { fmtDate, fmtTime, kindLabel } from '../lib/library'
import { mine } from '../lib/mine'
import { nowPlaying as song } from '../lib/player'
import { useStore, type View } from '../lib/store'

/**
 * The song playing, all there is of it: every artist on it (who features too, from Deezer; else what its tags say,
 * split), its album, date, BPM, and its file. A panel in the page's place (a wide screen) or the cover's (a phone).
 */
const emit = defineEmits<{ close: []; go: [View] }>()
const { api, server, device, library, openFetch } = useStore()

const info = ref<SongInfo | null>(null)
const loading = ref(false)
const failed = ref('')
/** found by its title and artist (a song not linked to Deezer) */
const searched = ref(false)
/**
 * Deezer is asked by the app itself when it can (an app: with or without a server, a song of the cloud by its id, any
 * other searched by its artist and title); the web asks its server, for the songs of the cloud only. Without either, or
 * when Deezer does not have it, what the file's tags say.
 */
watch(() => song.value?.key, async () => {
  const s = song.value
  info.value = null
  failed.value = ''
  searched.value = false
  if (!s) return
  loading.value = true
  try {
    let got: SongInfo | null = null
    if (openFetch) {
      try { got = await deezerSongInfo(s, openFetch) } catch (err) { if (!(server && s.trackId)) throw err }
    }
    if (!got && !openFetch && server && s.trackId) got = await api.songInfo(s.trackId)
    else if (!got && openFetch && server && s.trackId) got = await api.songInfo(s.trackId).catch(() => null)
    if (song.value?.key !== s.key) return
    info.value = got
    searched.value = !!got && !s.trackId
    if (!got) {
      failed.value = s.trackId ? 'Deezer no tiene más información de esta canción.'
        : openFetch ? 'No la he encontrado en Deezer: es lo que dicen las etiquetas del archivo.'
        : 'Es lo que dicen las etiquetas del archivo.'
    }
  } catch (err: any) {
    if (song.value?.key !== s.key) return
    // a 404 of the route itself (a server older than this page) is not Deezer not knowing the song
    failed.value = err?.status === 404 && /deezer/i.test(err?.message || '') ? 'Deezer no tiene más información de esta canción.'
      : err?.status === 404 ? 'Tu servidor de El Reproductor aún no da esta información: hay que actualizarlo.'
      : `No se pudo preguntar a Deezer: ${err?.message || err}. Es lo que dicen las etiquetas del archivo.`
  } finally { if (song.value?.key === s.key) loading.value = false }
}, { immediate: true })

/** the library's artists, by name: a name it knows whole is not split */
const libraryNames = computed(() => new Set([...library.artists.map((a) => a.name), ...(device ? device.artists.map((a) => a.name) : [])]
  .map((n) => n.trim().toLowerCase())))

/** Its tags' artists, one by one: «Porta, Rozalén», «A & B», «A feat. B», «A / B», and who the title says features.
 *  A name the library knows whole (AC/DC, Simon & Garfunkel) stays whole. */
function tagged(text: string, title: string): string[] {
  const names = libraryNames.value.has(text.trim().toLowerCase()) ? [text]
    : text.split(/\s*(?:,|;|&|•|\bfeat\.?|\bft\.?|\bfeaturing\b|\bcon\b)\s*|\s+\/\s+/i)
  const featured = /\((?:feat\.?|ft\.?|featuring|con|with)\s+([^)]+)\)/i.exec(title)?.[1]
  if (featured) names.push(...featured.split(/\s*(?:,|&|\by\b|\band\b)\s*/i))
  const seen = new Set<string>()
  return names.map((n) => n.trim()).filter((n) => n && !seen.has(n.toLowerCase()) && !!seen.add(n.toLowerCase()))
}

const artists = computed(() => {
  const s = song.value
  if (!s) return []
  if (info.value?.artists.length) {
    // their page: the server's (any Deezer artist), else this device's one of that name, if there is
    return info.value.artists.map((a) => {
      const here = device?.artists.find((d) => plainName(d.name) === plainName(a.name))
      return { key: `d${a.id}`, name: a.name, picture: a.picture, role: a.role === 'main' ? 'Artista principal' : 'Colabora',
               view: server ? ({ v: 'artist', id: a.id } as View) : here ? ({ v: 'lartist', name: here.name } as View) : null }
    })
  }
  const names = tagged(s.device ? s.artistName && s.artistName !== s.artist ? `${s.artist}, ${s.artistName}` : s.artist : s.artist, s.title)
  return names.map((name, i) => ({
    key: `t${name}`, name, picture: null as string | null, role: i === 0 ? 'Artista' : 'Colabora',
    view: s.device && device ? ({ v: 'lartist', name } as View) : i === 0 && server && s.artistId ? ({ v: 'artist', id: s.artistId } as View) : null
  }))
})
const albumView = computed<View | null>(() => {
  const s = song.value
  if (s?.device) return device && s.albumKey ? { v: 'lalbum', key: s.albumKey } : null
  const id = info.value?.album?.id || s?.albumId || 0
  return server && id ? { v: 'release', id } : null
})
const duration = computed(() => fmtTime(info.value?.duration || song.value?.duration || 0))
const plays = computed(() => (song.value ? mine.counts[song.value.key] || 0 : 0))
const format = computed(() => {
  const ext = (song.value?.path.split('?')[0].split('.').pop() || '').toLowerCase()
  return ext && ext.length <= 5 ? ext.toUpperCase() : ''
})
const where = computed(() => {
  const s = song.value
  if (!s) return ''
  if (s.device) return 'En este dispositivo'
  if (s.path.startsWith('/')) return 'En tu nube'
  return 'En una de tus bibliotecas'
})
function open(v: View) { emit('go', v) }
</script>
