<template>
  <!-- shrunk: a bar as the phone's widget (the song on the left, its buttons on the right, the progress at the bottom) -->
  <div v-if="compact" class="rp-mpc" :style="{ '--rp-tint': tint || undefined }" data-tauri-drag-region @wheel.passive="wheel">
    <img v-if="shown.cover" :src="shown.cover" alt="" class="rp-mpc-bg" data-tauri-drag-region />
    <span class="rp-mpc-scrim" data-tauri-drag-region></span>
    <div class="rp-mpc-row" data-tauri-drag-region>
      <span v-if="volumeOpen" class="rp-mpc-text rp-mp-volume">
        <button class="rp-mp-btn rp-mpc-small" :title="view.volume ? 'Silenciar' : 'Quitar el silencio'" @click="toggleMute">
          <i :class="['rp-i', view.volume ? 'rp-i-volume' : 'rp-i-volume-mute']" aria-hidden="true"></i>
        </button>
        <input class="rp-mp-vol" type="range" min="0" max="1" step="0.02" :value="view.volume" aria-label="Volumen" @input="volumeFrom" />
        <small class="rp-mp-vol-n">{{ Math.round(view.volume * 100) }}</small>
      </span>
      <span v-else class="rp-mpc-text" data-tauri-drag-region>
        <strong class="rp-ellipsis" :title="shown.title" data-tauri-drag-region>{{ shown.title }}</strong>
        <small class="rp-ellipsis" data-tauri-drag-region>{{ far ? `En ${controlled?.name}` : shown.artist }}</small>
      </span>
      <span class="rp-mpc-controls">
        <button class="rp-mp-btn rp-mp-big" title="Anterior" @click="control.prev"><i class="rp-i rp-i-prev" aria-hidden="true"></i></button>
        <button class="rp-mp-play rp-mpc-play" :disabled="view.loading" :title="view.playing ? 'Pausar' : 'Reproducir'" @click="control.toggle">
          <span v-if="view.loading" class="rp-spin"></span><i v-else :class="['rp-i', view.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i>
        </button>
        <button class="rp-mp-btn rp-mp-big" title="Siguiente" @click="control.next"><i class="rp-i rp-i-next" aria-hidden="true"></i></button>
        <button :class="['rp-mp-btn', { on: volumeOpen }]" :title="volumeOpen ? 'Ver la canción' : 'Volumen (también con la rueda del ratón)'" :aria-pressed="volumeOpen"
                @click="volumeOpen = !volumeOpen"><i :class="['rp-i', view.volume ? 'rp-i-volume' : 'rp-i-volume-mute']" aria-hidden="true"></i></button>
      </span>
      <span class="rp-mpc-side">
        <button class="rp-mp-btn rp-mpc-small" title="Agrandar: la tarjeta con la portada" @click="setCompact(false)"><i class="rp-i rp-i-up" aria-hidden="true"></i></button>
        <button class="rp-mp-btn rp-mpc-small" title="Volver a la app completa" @click="mini?.exit()"><i class="rp-i rp-i-expand" aria-hidden="true"></i></button>
      </span>
    </div>
    <div class="rp-mp-bar rp-mpc-bar" role="slider" tabindex="0" aria-label="Posición" :aria-valuemin="0" :aria-valuemax="Math.round(view.duration)"
         :aria-valuenow="Math.round(view.time)" @click="seek"><i :style="{ width: fraction * 100 + '%' }"></i></div>
  </div>

  <div v-else class="rp-mp" :style="{ '--rp-tint': tint || undefined }">
    <!-- a card like a trading card: dragged by its top strip (the desktop's window has no frame) -->
    <div class="rp-mp-top" data-tauri-drag-region>
      <span class="rp-mp-from rp-ellipsis" data-tauri-drag-region>{{ far ? `En ${controlled?.name}` : open ? tabLabel : lyrics ? 'Letra' : 'El Reproductor' }}</span>
      <button class="rp-mp-btn" title="Encoger: una barra como el widget del móvil" @click="setCompact(true)"><i class="rp-i rp-i-down" aria-hidden="true"></i></button>
      <button v-if="!far" :class="['rp-mp-btn', { on: lyrics }]" :title="lyrics ? 'Ver la portada' : 'Letra'" :aria-pressed="lyrics" @click="toggleLyrics">
        <i class="rp-i rp-i-lyrics" aria-hidden="true"></i>
      </button>
      <button :class="['rp-mp-btn', { on: open }]" :title="open ? 'Ver la portada' : 'Cola, listas, artistas e información'" :aria-expanded="open" @click="togglePanel">
        <i class="rp-i rp-i-playlist" aria-hidden="true"></i>
      </button>
      <button class="rp-mp-btn" title="Volver a la app completa" @click="mini?.exit()"><i class="rp-i rp-i-expand" aria-hidden="true"></i></button>
    </div>

    <!-- the cover, or in its place what to jump to (as the phone's player does with its panels) -->
    <div class="rp-mp-art">
      <div v-if="open" class="rp-mp-panel">
        <div class="rp-mp-tabs" role="tablist">
          <button v-for="t in tabs" :key="t.key" :class="{ on: tab === t.key }" role="tab" :aria-selected="tab === t.key" @click="tab = t.key">{{ t.label }}</button>
        </div>
        <input v-if="tab === 'lists' || tab === 'artists'" v-model="filter" class="rp-mp-filter" type="search"
               :placeholder="tab === 'lists' ? 'Buscar una lista' : 'Buscar un artista'" />

        <ol v-if="tab === 'queue'" ref="queueEl" class="rp-mp-list">
          <li v-if="!player.queue.length" class="rp-mp-none">No hay nada en la cola.</li>
          <li v-for="(s, i) in player.queue" :key="s.key + i" :class="{ on: i === player.index, past: i < player.index }">
            <button @click="jump(i)">
              <img v-if="s.cover" :src="s.cover" alt="" loading="lazy" />
              <span v-else class="rp-mp-pic"><i class="rp-i rp-i-music" aria-hidden="true"></i></span>
              <span class="rp-mp-row"><span class="rp-ellipsis">{{ s.title }}</span><small class="rp-ellipsis">{{ s.artist }}</small></span>
            </button>
          </li>
        </ol>

        <ul v-else-if="tab === 'lists' || tab === 'artists'" class="rp-mp-list">
          <li v-if="!entries.length" class="rp-mp-none">{{ filter.trim() ? `Nada con «${filter.trim()}».` : tab === 'lists' ? 'Aún no tienes listas.' : 'Aún no hay artistas.' }}</li>
          <li v-for="e in entries" :key="e.key">
            <button :disabled="starting === e.key" :title="`Reproducir «${e.name}»`" @click="start(e)">
              <img v-if="e.picture" :src="e.picture" alt="" loading="lazy" :class="{ round: tab === 'artists' }" />
              <span v-else :class="['rp-mp-pic', { round: tab === 'artists' }]"><i :class="['rp-i', e.icon]" aria-hidden="true"></i></span>
              <span class="rp-mp-row"><span class="rp-ellipsis">{{ e.name }}</span><small v-if="e.note" class="rp-ellipsis">{{ e.note }}</small></span>
              <span v-if="starting === e.key" class="rp-spin"></span><i v-else class="rp-i rp-i-play rp-mp-go" aria-hidden="true"></i>
            </button>
          </li>
        </ul>

        <div v-else-if="tab === 'info'" class="rp-full-panel rp-mp-info"><SongInfoPanel @close="tab = 'queue'" @go="goFull" /></div>
      </div>
      <div v-else-if="lyrics && !far" class="rp-mp-lyrics rp-full-lyrics"><LyricsPanel @close="lyrics = false" /></div>
      <img v-else-if="shown.cover" :src="shown.cover" alt="" class="rp-mp-cover" data-tauri-drag-region />
      <span v-else class="rp-mp-cover rp-cover-none" data-tauri-drag-region><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
    </div>

    <div class="rp-mp-meta" data-tauri-drag-region>
      <strong class="rp-ellipsis" :title="shown.title" data-tauri-drag-region>{{ shown.title }}</strong>
      <small class="rp-ellipsis" data-tauri-drag-region>{{ [shown.artist, shown.album].filter(Boolean).join(' · ') }}</small>
    </div>

    <div class="rp-mp-progress">
      <div class="rp-mp-bar" role="slider" tabindex="0" aria-label="Posición" :aria-valuemin="0" :aria-valuemax="Math.round(view.duration)"
           :aria-valuenow="Math.round(view.time)" @click="seek"><i :style="{ width: fraction * 100 + '%' }"></i></div>
      <div class="rp-mp-times"><span>{{ fmtTime(view.time) || '0:00' }}</span><span>{{ fmtTime(view.duration) || '0:00' }}</span></div>
    </div>

    <div class="rp-mp-controls">
      <button :class="['rp-mp-btn', { on: view.shuffle }]" title="Aleatorio" :aria-pressed="view.shuffle" @click="control.shuffle"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i></button>
      <button class="rp-mp-btn rp-mp-big" title="Anterior" @click="control.prev"><i class="rp-i rp-i-prev" aria-hidden="true"></i></button>
      <button class="rp-mp-play" :disabled="view.loading" :title="view.playing ? 'Pausar' : 'Reproducir'" @click="control.toggle">
        <span v-if="view.loading" class="rp-spin"></span><i v-else :class="['rp-i', view.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i>
      </button>
      <button class="rp-mp-btn rp-mp-big" title="Siguiente" @click="control.next"><i class="rp-i rp-i-next" aria-hidden="true"></i></button>
      <button :class="['rp-mp-btn', { on: view.repeat }]" title="Repetir la cola" :aria-pressed="view.repeat" @click="control.repeat"><i class="rp-i rp-i-repeat" aria-hidden="true"></i></button>
    </div>

    <div class="rp-mp-volume rp-mp-volrow" @wheel.passive="wheel">
      <button class="rp-mp-btn rp-mpc-small" :title="view.volume ? 'Silenciar' : 'Quitar el silencio'" @click="toggleMute">
        <i :class="['rp-i', view.volume ? 'rp-i-volume' : 'rp-i-volume-mute']" aria-hidden="true"></i>
      </button>
      <input class="rp-mp-vol" type="range" min="0" max="1" step="0.02" :value="view.volume" aria-label="Volumen" @input="volumeFrom" />
      <small class="rp-mp-vol-n">{{ Math.round(view.volume * 100) }}</small>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { connect, control, controlled, remote } from '../lib/connect'
import { coverColor } from '../lib/cover-color'
import { fmtTime } from '../lib/library'
import { mine, topFavorites } from '../lib/mine'
import { jump, nowPlaying, player } from '../lib/player'
import { playAll } from '../lib/sources'
import { queryFromView, useStore, type LibraryEntry, type View } from '../lib/store'
import LyricsPanel from './LyricsPanel.vue'
import SongInfoPanel from './SongInfoPanel.vue'

/**
 * The desktop's mini player: the app made a card like a trading card (its window always on top, anywhere on the
 * screen): the cover, what plays and its buttons; in the cover's place, the queue to jump in, the lists and artists to
 * play at a touch (the most listened first) and the song's info. Its window is the app's (`mini` of the store).
 */
const { api, device, library, mini, go, notify } = useStore()

const far = computed(() => !!connect.controlling)
const shown = computed(() => (far.value ? remote.value?.song || { title: 'Sin nada sonando', artist: '', album: '', cover: null }
  : nowPlaying.value || { title: 'Nada sonando', artist: '', album: '', cover: null }))
const view = computed(() => {
  const r = remote.value
  if (far.value) return { playing: !!r?.playing, loading: false, time: r?.time || 0, duration: r?.duration || r?.song?.duration || 0, shuffle: !!r?.shuffle, repeat: !!r?.repeat, volume: r?.volume ?? 1 }
  return { playing: player.playing, loading: player.loading, time: player.time, duration: player.duration, shuffle: player.shuffle, repeat: player.repeat, volume: player.volume }
})
const fraction = computed(() => (view.value.duration ? Math.min(1, view.value.time / view.value.duration) : 0))
function seek(e: MouseEvent) {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
  control.seek(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)))
}
// ---- the volume: its slider, the mouse wheel over it (over the whole bar when shrunk), silenced and back as it was ----
const volumeOpen = ref(false)
let unmuted = 1
function setVolume(v: number) { control.volume(Math.round(Math.max(0, Math.min(1, v)) * 100) / 100) }
function volumeFrom(e: Event) { setVolume((e.target as HTMLInputElement).valueAsNumber) }
function wheel(e: WheelEvent) { if (e.deltaY) setVolume(view.value.volume + (e.deltaY < 0 ? 0.05 : -0.05)) }
function toggleMute() {
  if (view.value.volume > 0) { unmuted = view.value.volume; setVolume(0) } else setVolume(unmuted || 0.5)
}
const tint = ref('')
watch(() => shown.value.cover, async (cover) => { tint.value = (await coverColor(cover)) || '' }, { immediate: true })

// ---- shrunk to a bar (kept for the next times by the app, with its window) ----
const compact = ref(!!mini?.compact)
function setCompact(on: boolean) {
  compact.value = on
  if (on) { open.value = false; lyrics.value = false }
  mini?.setCompact(on)
}

// ---- unfolded: the queue, the lists, the artists, the song's info ----
const open = ref(false)
function togglePanel() { open.value = !open.value; if (open.value) lyrics.value = false }
// ---- the lyrics, in the cover's place (only of what plays here: those of another device are not at hand) ----
const lyrics = ref(false)
function toggleLyrics() { lyrics.value = !lyrics.value; if (lyrics.value) open.value = false }
watch(far, (on) => { if (on) lyrics.value = false })
type Tab = 'queue' | 'lists' | 'artists' | 'info'
const tabs: { key: Tab; label: string }[] = [{ key: 'queue', label: 'Cola' }, { key: 'lists', label: 'Listas' }, { key: 'artists', label: 'Artistas' }, { key: 'info', label: 'Info' }]
const tab = ref<Tab>('queue')
const tabLabel = computed(() => tabs.find((t) => t.key === tab.value)?.label || '')
const filter = ref('')
watch(tab, () => { filter.value = '' })
const queueEl = ref<HTMLElement>()
watch([open, tab], () => { if (open.value && tab.value === 'queue') nextTick(() => queueEl.value?.querySelector('li.on')?.scrollIntoView({ block: 'center' })) })

const viewKey = (v: View) => JSON.stringify(queryFromView(v))
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
interface Row { key: string; name: string; note?: string; picture?: string | null; icon: string; view: View }
/** the lists or the artists, the most listened lately first (then as the library has them), narrowed by the filter */
const entries = computed<Row[]>(() => {
  const rank = new Map(topFavorites(mine.favorites, Date.now(), 0.05).map((f, i) => [viewKey(f.view), i]))
  const rows: Row[] = tab.value === 'lists'
    ? [...(mine.likes.length ? [{ key: 'likes', name: 'Me gusta', note: `${mine.likes.length} canciones`, icon: 'rp-i-heart-fill', view: { v: 'likes' } as View }] : []),
       ...library.lists.map((e: LibraryEntry) => ({ key: e.key, name: e.name, note: e.note, icon: 'rp-i-playlist', view: e.view }))]
    : library.artists.map((e: LibraryEntry) => ({ key: e.key, name: e.name, note: e.note, picture: e.picture, icon: 'rp-i-artist', view: e.view }))
  const q = plain(filter.value.trim())
  return rows.filter((r) => !q || plain(r.name).includes(q))
    .map((r, i) => ({ r, i, at: rank.get(viewKey(r.view)) ?? Infinity }))
    .sort((a, b) => a.at - b.at || a.i - b.i).map((x) => x.r)
})
const starting = ref('')
async function start(e: Row) {
  starting.value = e.key
  try {
    if (!(await playAll(e.view, e.name, api, device))) notify(`«${e.name}» no tiene nada que reproducir aquí.`, true)
  } catch (err: any) { notify(err?.message || String(err), true) } finally { starting.value = '' }
}
/** a page from the song's info (its artist, its album): the whole app, at that page */
function goFull(v: View) {
  mini?.exit()
  go(v)
}
</script>
