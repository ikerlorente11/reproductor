<template>
  <footer v-if="shown" :class="['rp-player', { 'rp-player-far': far }]" aria-label="Reproductor">
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
      <button :class="['rp-pbtn', 'rp-like', { on: liked }]" :title="liked ? 'Quitar de Me gusta' : 'Me gusta'" :aria-pressed="liked" @click="toggleLike(song)">
        <i :class="['rp-i', liked ? 'rp-i-heart-fill' : 'rp-i-heart']" aria-hidden="true"></i></button>
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
      <button v-if="!far" :class="['rp-pbtn', { on: showLyrics }]" title="Letra" :aria-pressed="showLyrics" @click="showLyrics = !showLyrics; showQueue = false"><i class="rp-i rp-i-lyrics" aria-hidden="true"></i></button>
      <button v-if="!far" :class="['rp-pbtn', { on: showQueue }]" title="Cola" @click="showQueue = !showQueue; showLyrics = false"><i class="rp-i rp-i-queue" aria-hidden="true"></i></button>
      <span class="rp-muted"><i class="rp-i rp-i-volume" aria-hidden="true"></i></span>
      <input class="rp-vol" type="range" min="0" max="1" step="0.02" :value="view.volume" aria-label="Volumen"
             @input="control.volume(($event.target as HTMLInputElement).valueAsNumber)" />
    </div>
    <p v-if="player.error && !far" class="rp-perror">{{ player.error }}</p>

    <LyricsPanel v-if="showLyrics && !far" @close="showLyrics = false" />
    <aside v-if="showQueue && !far" class="rp-queue" aria-label="Cola">
      <header class="rp-queue-head"><strong>Cola</strong><span class="rp-muted rp-small">{{ player.index + 1 }} de {{ player.queue.length }}</span>
        <span class="rp-grow"></span><button class="rp-mini" title="Cerrar" @click="showQueue = false"><i class="rp-i rp-i-close" aria-hidden="true"></i></button></header>
      <ol>
        <li v-for="(s, i) in player.queue" :key="s.key" :class="{ on: i === player.index, past: i < player.index }" @dblclick="jump(i)">
          <button class="rp-mini" :title="i === player.index ? 'Sonando' : 'Reproducir'" @click="jump(i)"><i :class="['rp-i', i === player.index ? 'rp-i-music' : 'rp-i-play']" aria-hidden="true"></i></button>
          <span class="rp-tinfo"><span class="rp-ellipsis">{{ s.title }}</span><small class="rp-muted rp-ellipsis">{{ s.artist }}</small></span>
          <button v-if="i !== player.index" class="rp-mini" title="Quitar de la cola" @click="removeAt(i)"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
        </li>
      </ol>
    </aside>
  </footer>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { fmtTime } from '../lib/library'
import { isLiked, toggleLike } from '../lib/mine'
import { connect, control, controlled, remote } from '../lib/connect'
import { hasNext, hasPrev, jump, nowPlaying as song, player, removeAt } from '../lib/player'
import { useStore, type View } from '../lib/store'
import DevicePicker from './DevicePicker.vue'
import LyricsPanel from './LyricsPanel.vue'

const { go, server, device } = useStore()
const showQueue = ref(false)
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
const showLyrics = ref(false)
/** Where the title leads: the album the song is on (a loose song's own row is not a page). */
const albumOfSong = computed(() => song.value?.albumId || (song.value?.releaseId && song.value.releaseId > 0 ? song.value.releaseId : 0))
/** Where the title and the artist lead: a song of this device to its pages here, a cloud one to the server's. */
const albumView = computed<View | null>(() => (song.value?.device ? (device && song.value.albumKey ? { v: 'lalbum', key: song.value.albumKey } : null)
  : server && albumOfSong.value ? { v: 'release', id: albumOfSong.value } : null))
const artistView = computed<View | null>(() => (song.value?.device ? (device ? { v: 'lartist', name: song.value.artistName || song.value.artist } : null)
  : server && song.value?.artistId ? { v: 'artist', id: song.value.artistId } : null))
const liked = computed(() => isLiked(song.value))
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
</script>
