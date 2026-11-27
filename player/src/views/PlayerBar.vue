<template>
  <!-- a phone: a bar over the tabs while moving around the app; touched, the player takes the whole screen -->
  <template v-if="phone">
    <div v-if="shown" v-bind="$attrs" class="rp-minibar" :style="{ '--rp-tint': tint || undefined }" role="button" tabindex="0" aria-label="Abrir el reproductor"
         @click="openFull" @keydown.enter="openFull">
      <img v-if="shown.cover" :src="shown.cover" alt="" class="rp-minibar-cover" />
      <span v-else class="rp-minibar-cover rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
      <span class="rp-minibar-text">
        <strong class="rp-ellipsis">{{ shown.title }}</strong>
        <small class="rp-ellipsis">
          <template v-if="far"><i class="rp-i rp-i-devices" aria-hidden="true"></i> {{ controlled?.name }}</template>
          <template v-else>{{ shown.artist }}</template>
        </small>
      </span>
      <span class="rp-minibar-devices" @click.stop><DevicePicker v-if="connect.on" :count="false" /></span>
      <button class="rp-minibar-play" :disabled="view.loading" :aria-label="view.playing ? 'Pausar' : 'Reproducir'" @click.stop="control.toggle">
        <span v-if="view.loading" class="rp-spin"></span><i v-else :class="['rp-i', view.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i>
      </button>
      <span class="rp-minibar-progress"><i :style="{ width: playedFraction * 100 + '%' }"></i></span>
    </div>

    <div v-if="full && shown" class="rp-full" :style="{ '--rp-tint': tint || undefined }" role="dialog" aria-label="Reproduciendo"
         @touchstart.passive="swipeStart" @touchend="swipeEnd">
      <header class="rp-full-head">
        <button class="rp-iconbtn" aria-label="Cerrar el reproductor" @click="closeFull"><i class="rp-i rp-i-down" aria-hidden="true"></i></button>
        <span class="rp-full-from">
          <small>{{ far ? 'Reproduciendo en' : shown.album ? 'Del disco' : 'Reproduciendo' }}</small>
          <strong class="rp-ellipsis">{{ far ? controlled?.name : shown.album || shown.artist }}</strong>
        </span>
        <button v-if="!far" class="rp-iconbtn" aria-label="Cola" @click="togglePanel('queue')"><i class="rp-i rp-i-queue" aria-hidden="true"></i></button>
        <span v-else class="rp-iconbtn"></span>
      </header>
      <div :class="['rp-full-art', { 'rp-full-panel': inFull, 'rp-full-lyrics': panel === 'lyrics' && inFull }]">
        <LyricsPanel v-if="panel === 'lyrics' && inFull" @close="panel = ''" />
        <QueuePanel v-else-if="panel === 'queue' && inFull" @close="panel = ''" />
        <DevicesPanel v-else-if="panel === 'devices'" @close="panel = ''" />
        <SongInfoPanel v-else-if="panel === 'info' && inFull" @close="panel = ''" @go="goFromFull" />
        <img v-else-if="shown.cover" :src="shown.cover" alt="" />
        <span v-else class="rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
      </div>
      <div class="rp-full-meta">
        <a v-if="!far && albumView" href="#" class="rp-full-title rp-ellipsis" @click.prevent="goFromFull(albumView)">{{ shown.title }}</a>
        <strong v-else class="rp-full-title rp-ellipsis">{{ shown.title }}</strong>
        <a v-if="!far && artistView && shown.artist" href="#" class="rp-full-artist rp-ellipsis" @click.prevent="goFromFull(artistView)">{{ shown.artist }}</a>
        <span v-else class="rp-full-artist rp-ellipsis">{{ shown.artist }}</span>
      </div>
      <div class="rp-full-progress" @touchstart.stop.passive @touchend.stop>
        <div :class="['rp-pbarline', { dragging: dragAt !== null }]" role="slider" tabindex="0" aria-label="Posición"
             :aria-valuemin="0" :aria-valuemax="Math.round(view.duration)" :aria-valuenow="Math.round(shownTime)" :aria-valuetext="fmtTime(shownTime)"
             @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragAt = null">
          <span class="rp-pbartrack"><i :style="{ width: shownFraction * 100 + '%' }"></i></span>
          <span class="rp-pbarknob" :style="{ left: shownFraction * 100 + '%' }"></span>
        </div>
        <div class="rp-full-times"><span>{{ fmtTime(shownTime) || '0:00' }}</span><span>{{ fmtTime(view.duration) || '0:00' }}</span></div>
      </div>
      <div class="rp-full-controls">
        <button :class="['rp-fbtn', { on: view.shuffle }]" aria-label="Aleatorio" :aria-pressed="view.shuffle" @click="control.shuffle"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i></button>
        <button class="rp-fbtn rp-fbtn-big" aria-label="Anterior" :disabled="!far && !hasPrev" @click="control.prev"><i class="rp-i rp-i-prev" aria-hidden="true"></i></button>
        <button class="rp-fbtn rp-fbtn-main" :disabled="view.loading" :aria-label="view.playing ? 'Pausar' : 'Reproducir'" @click="control.toggle">
          <span v-if="view.loading" class="rp-spin"></span><i v-else :class="['rp-i', view.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i>
        </button>
        <button class="rp-fbtn rp-fbtn-big" aria-label="Siguiente" :disabled="!far && !hasNext" @click="control.next"><i class="rp-i rp-i-next" aria-hidden="true"></i></button>
        <button :class="['rp-fbtn', { on: view.repeat }]" aria-label="Repetir la cola" :aria-pressed="view.repeat" @click="control.repeat"><i class="rp-i rp-i-repeat" aria-hidden="true"></i></button>
      </div>
      <div class="rp-full-foot">
        <DevicePicker v-if="connect.on" />
        <span class="rp-grow"></span>
        <PlaybackMenu v-if="!far" button-class="rp-pbtn" />
        <button v-if="!far" :class="['rp-fbtn', { on: panel === 'info' }]" aria-label="Información de la canción" @click="togglePanel('info')"><i class="rp-i rp-i-info" aria-hidden="true"></i></button>
        <button v-if="!far" :class="['rp-fbtn', { on: showLyrics }]" aria-label="Letra" @click="togglePanel('lyrics')"><i class="rp-i rp-i-lyrics" aria-hidden="true"></i></button>
      </div>
      <p v-if="player.error && !far" class="rp-perror">{{ player.error }}</p>
    </div>
  </template>

  <footer v-else-if="shown" v-bind="$attrs" :class="['rp-player', { 'rp-player-far': far }]" aria-label="Reproductor">
    <div v-if="far" class="rp-pconnect"><i class="rp-i rp-i-devices" aria-hidden="true"></i> Reproduciendo en {{ controlled?.name }}</div>
    <div v-if="far" class="rp-pinfo">
      <img v-if="shown.cover" :src="shown.cover" alt="" class="rp-pcover" />
      <span v-else class="rp-pcover rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
      <span class="rp-pinfo-text">
        <strong class="rp-ellipsis">{{ shown.title }}</strong>
        <small class="rp-muted rp-ellipsis">{{ [shown.artist, shown.album].filter(Boolean).join(' · ') }}</small>
      </span>
    </div>
    <div v-else-if="song" class="rp-pinfo">
      <img v-if="song.cover" :src="song.cover" alt="" class="rp-pcover" />
      <span v-else class="rp-pcover rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
      <span class="rp-pinfo-text">
        <a v-if="albumView" href="#" class="rp-ellipsis rp-plink" title="Ir a la canción, en su disco" @click.prevent="go(albumView)"><strong>{{ song.title }}</strong></a>
        <strong v-else class="rp-ellipsis">{{ song.title }}</strong>
        <small class="rp-muted rp-ellipsis rp-plinks">
          <a v-if="artistView && song.artist" href="#" class="rp-plink" title="Ir al artista" @click.prevent="go(artistView)">{{ song.artist }}</a>
          <template v-else>{{ song.artist }}</template>
          <template v-if="song.artist && song.album"> · </template>
          <a v-if="albumView && song.album" href="#" class="rp-plink" title="Ir al disco" @click.prevent="go(albumView)">{{ song.album }}</a>
          <template v-else>{{ song.album }}</template>
        </small>
      </span>
    </div>
    <div class="rp-pcenter">
      <div class="rp-pcontrols">
        <button :class="['rp-pbtn', { on: view.shuffle }]" title="Aleatorio" @click="control.shuffle"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i></button>
        <button class="rp-pbtn" title="Anterior" :disabled="!far && !hasPrev" @click="control.prev"><i class="rp-i rp-i-prev" aria-hidden="true"></i></button>
        <button class="rp-pbtn rp-pmain" :disabled="view.loading" :aria-label="view.playing ? 'Pausar' : 'Reproducir'" @click="control.toggle">
          <span v-if="view.loading" class="rp-spin"></span><i v-else :class="['rp-i', view.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i>
        </button>
        <button class="rp-pbtn" title="Siguiente" :disabled="!far && !hasNext" @click="control.next"><i class="rp-i rp-i-next" aria-hidden="true"></i></button>
        <button :class="['rp-pbtn', { on: view.repeat }]" :title="view.repeat ? 'Repetir: al terminar la cola vuelve a empezar' : 'Sin repetir: se para al terminar la cola'" :aria-pressed="view.repeat" @click="control.repeat"><i class="rp-i rp-i-repeat" aria-hidden="true"></i></button>
      </div>
      <div class="rp-pprogress">
        <span class="rp-ptime">{{ fmtTime(shownTime) || '0:00' }}</span>
        <div :class="['rp-pbarline', { dragging: dragAt !== null }]" role="slider" tabindex="0" aria-label="Posición"
             :aria-valuemin="0" :aria-valuemax="Math.round(view.duration)" :aria-valuenow="Math.round(shownTime)" :aria-valuetext="fmtTime(shownTime)"
             @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragAt = null" @keydown="seekKey">
          <span class="rp-pbartrack"><i :style="{ width: shownFraction * 100 + '%' }"></i></span>
          <span class="rp-pbarknob" :style="{ left: shownFraction * 100 + '%' }"></span>
        </div>
        <span class="rp-ptime">{{ fmtTime(view.duration) || '0:00' }}</span>
      </div>
    </div>
    <div class="rp-pright">
      <DevicePicker v-if="connect.on" />
      <button v-if="!far" :class="['rp-pbtn', { on: panel === 'info' }]" title="Información de la canción" :aria-pressed="panel === 'info'" @click="togglePanel('info')"><i class="rp-i rp-i-info" aria-hidden="true"></i></button>
      <button v-if="!far" :class="['rp-pbtn', { on: showLyrics }]" title="Letra" :aria-pressed="showLyrics" @click="togglePanel('lyrics')"><i class="rp-i rp-i-lyrics" aria-hidden="true"></i></button>
      <button v-if="!far" :class="['rp-pbtn', { on: showQueue }]" title="Cola" @click="togglePanel('queue')"><i class="rp-i rp-i-queue" aria-hidden="true"></i></button>
      <PlaybackMenu v-if="!far" />
      <button v-if="mini" class="rp-pbtn" title="Mini reproductor: una tarjeta pequeña, siempre encima, donde quieras" @click="mini.enter()"><i class="rp-i rp-i-mini" aria-hidden="true"></i></button>
      <span class="rp-muted"><i class="rp-i rp-i-volume" aria-hidden="true"></i></span>
      <input class="rp-vol" type="range" min="0" max="1" step="0.02" :value="view.volume" aria-label="Volumen"
             @input="control.volume(($event.target as HTMLInputElement).valueAsNumber)" />
    </div>
    <p v-if="player.error && !far" class="rp-perror">{{ player.error }}</p>

  </footer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { coverColor } from '../lib/cover-color'
import { isPhone as phone, panel, togglePanel } from '../lib/phone'
import { fmtTime } from '../lib/library'
import { connect, control, controlled, remote } from '../lib/connect'
import { hasNext, hasPrev, jump, nowPlaying as song, player, removeAt } from '../lib/player'
import { useStore, type View } from '../lib/store'
import DevicePicker from './DevicePicker.vue'
import LyricsPanel from './LyricsPanel.vue'
import QueuePanel from './QueuePanel.vue'
import DevicesPanel from './DevicesPanel.vue'
import PlaybackMenu from './PlaybackMenu.vue'
import SongInfoPanel from './SongInfoPanel.vue'

defineOptions({ inheritAttrs: false })
const { go, server, device, mini } = useStore()
/** Driving another device (connect.ts): the bar shows what plays there and its buttons act there. */
const far = computed(() => !!connect.controlling)
const shown = computed(() => (far.value ? remote.value?.song || { title: 'Sin nada sonando', artist: '', album: '', cover: null } : song.value))
const view = computed(() => {
  const r = remote.value
  if (far.value) return { playing: !!r?.playing, loading: false, time: r?.time || 0, duration: r?.duration || r?.song?.duration || 0,
                          shuffle: !!r?.shuffle, repeat: !!r?.repeat, volume: r?.volume ?? 1 }
  return { playing: player.playing, loading: player.loading, time: player.time, duration: player.duration, shuffle: player.shuffle,
           repeat: player.repeat, volume: player.volume }
})
/** the panel open (lyrics, queue, devices), shared with the Shell, which shows it in the page's place on a wide screen */
const showLyrics = computed(() => panel.value === 'lyrics')
const showQueue = computed(() => panel.value === 'queue')
/** a panel in the phone's player, in the cover's place (another device controlled: only its devices' panel) */
const inFull = computed(() => !!panel.value && (!far.value || panel.value === 'devices'))
/** Where the title leads: the album the song is on (a loose song's own row is not a page). */
const albumOfSong = computed(() => song.value?.albumId || (song.value?.releaseId && song.value.releaseId > 0 ? song.value.releaseId : 0))
/** Where the title and the artist lead: a song of this device to its pages here, a cloud one to the server's. */
const albumView = computed<View | null>(() => (song.value?.device ? (device && song.value.albumKey ? { v: 'lalbum', key: song.value.albumKey } : null)
  : server && albumOfSong.value ? { v: 'release', id: albumOfSong.value } : null))
const artistView = computed<View | null>(() => (song.value?.device ? (device ? { v: 'lartist', name: song.value.artistName || song.value.artist } : null)
  : server && song.value?.artistId ? { v: 'artist', id: song.value.artistId } : null))
// ---- the progress bar: click, or press and drag (it jumps there on release, so the sound does not stutter) ----
const dragAt = ref<number | null>(null)
const playedFraction = computed(() => (view.value.duration ? Math.min(1, view.value.time / view.value.duration) : 0))
const shownFraction = computed(() => dragAt.value ?? playedFraction.value)
const shownTime = computed(() => (dragAt.value !== null ? dragAt.value * view.value.duration : view.value.time))
function fractionAt(e: PointerEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
}
function dragStart(e: PointerEvent) {
  if (!view.value.duration || e.button > 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragAt.value = fractionAt(e)
}
function dragMove(e: PointerEvent) {
  if (dragAt.value !== null) dragAt.value = fractionAt(e)
}
function dragEnd(e: PointerEvent) {
  if (dragAt.value === null) return
  control.seek(fractionAt(e))
  dragAt.value = null
}
function seekKey(e: KeyboardEvent) {
  const v = view.value
  if (!v.duration || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
  e.preventDefault()
  e.stopPropagation()
  control.seek((v.time + (e.key === 'ArrowRight' ? 5 : -5)) / v.duration)
}

// ---- a phone: the player over the whole screen, with the colour of the cover behind ----
const full = ref(false)
const tint = ref('')
watch(() => shown.value?.cover, async (cover) => { tint.value = (await coverColor(cover)) || '' }, { immediate: true })
// the colour at the top of the screen, for an app that paints the system's status bar (Android): the cover's while open
watch([full, tint], ([open, color]) => {
  window.dispatchEvent(new CustomEvent('reproductor:top', { detail: open ? color || '#3a3a42' : null }))
})
/** Opened, it is one more step back: the system's back button (or the browser's) closes it. */
function openFull() {
  full.value = true
  history.pushState({ ...(history.state || {}), rpFull: true }, '')
}
function closeFull() {
  if (history.state?.rpFull) history.back()
  else full.value = false
}
function onPop() { if (full.value && !history.state?.rpFull) { full.value = false; panel.value = '' } }
// on a phone a panel opened from the bar (the devices' button) opens the player, with the panel in it
watch(panel, (p) => { if (p && phone.value && !full.value) openFull() })
window.addEventListener('popstate', onPop)
onBeforeUnmount(() => window.removeEventListener('popstate', onPop))
/** A page from the player (the album, the artist): it takes the player's step, so back leads to where you were. */
function goFromFull(v: View) {
  full.value = false
  panel.value = ''
  go(v, !!history.state?.rpFull)
}
// a swipe down closes it
let swipeY: number | null = null
function swipeStart(e: TouchEvent) { swipeY = (e.target as HTMLElement)?.closest?.('.rp-lyrics, .rp-panel') ? null : e.touches[0].clientY }
function swipeEnd(e: TouchEvent) {
  if (swipeY !== null && e.changedTouches[0].clientY - swipeY > 110) closeFull()
  swipeY = null
}
</script>
