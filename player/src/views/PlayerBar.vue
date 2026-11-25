<template>
  <footer v-if="song" class="rp-player" aria-label="Reproductor">
    <div class="rp-pinfo">
      <img v-if="song.cover" :src="song.cover" alt="" class="rp-pcover" />
      <span v-else class="rp-pcover rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
      <span class="rp-pinfo-text">
        <a v-if="albumOfSong" href="#" class="rp-ellipsis rp-plink" title="Ir a la canción, en su disco" @click.prevent="go({ v: 'release', id: albumOfSong })"><strong>{{ song.title }}</strong></a>
        <strong v-else class="rp-ellipsis">{{ song.title }}</strong>
        <small class="rp-muted rp-ellipsis rp-plinks">
          <a v-if="song.artistId && song.artist" href="#" class="rp-plink" title="Ir al artista" @click.prevent="go({ v: 'artist', id: song.artistId })">{{ song.artist }}</a>
          <template v-else>{{ song.artist }}</template>
          <template v-if="song.artist && song.album"> · </template>
          <a v-if="albumOfSong && song.album" href="#" class="rp-plink" title="Ir al disco" @click.prevent="go({ v: 'release', id: albumOfSong })">{{ song.album }}</a>
          <template v-else>{{ song.album }}</template>
        </small>
      </span>
    </div>
    <div class="rp-pcenter">
      <div class="rp-pcontrols">
        <button :class="['rp-pbtn', { on: player.shuffle }]" title="Aleatorio" @click="toggleShuffle"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i></button>
        <button class="rp-pbtn" title="Anterior" :disabled="!hasPrev" @click="prev"><i class="rp-i rp-i-prev" aria-hidden="true"></i></button>
        <button class="rp-pbtn rp-pmain" :disabled="player.loading" :aria-label="player.playing ? 'Pausar' : 'Reproducir'" @click="toggle">
          <span v-if="player.loading" class="rp-spin"></span><i v-else :class="['rp-i', player.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i>
        </button>
        <button class="rp-pbtn" title="Siguiente" :disabled="!hasNext" @click="next"><i class="rp-i rp-i-next" aria-hidden="true"></i></button>
        <button :class="['rp-pbtn', { on: player.repeat }]" :title="player.repeat ? 'Repetir: al terminar la cola vuelve a empezar' : 'Sin repetir: se para al terminar la cola'" :aria-pressed="player.repeat" @click="toggleRepeat"><i class="rp-i rp-i-repeat" aria-hidden="true"></i></button>
      </div>
      <div class="rp-pprogress">
        <span class="rp-ptime">{{ fmtTime(shownTime) || '0:00' }}</span>
        <div :class="['rp-pbarline', { dragging: dragAt !== null }]" role="slider" tabindex="0" aria-label="Posición"
             :aria-valuemin="0" :aria-valuemax="Math.round(player.duration)" :aria-valuenow="Math.round(shownTime)" :aria-valuetext="fmtTime(shownTime)"
             @pointerdown="dragStart" @pointermove="dragMove" @pointerup="dragEnd" @pointercancel="dragAt = null" @keydown="seekKey">
          <span class="rp-pbartrack"><i :style="{ width: shownFraction * 100 + '%' }"></i></span>
          <span class="rp-pbarknob" :style="{ left: shownFraction * 100 + '%' }"></span>
        </div>
        <span class="rp-ptime">{{ fmtTime(player.duration) || '0:00' }}</span>
      </div>
    </div>
    <div class="rp-pright">
      <button :class="['rp-pbtn', { on: showLyrics }]" title="Letra" :aria-pressed="showLyrics" @click="showLyrics = !showLyrics; showQueue = false"><i class="rp-i rp-i-lyrics" aria-hidden="true"></i></button>
      <button :class="['rp-pbtn', { on: showQueue }]" title="Cola" @click="showQueue = !showQueue; showLyrics = false"><i class="rp-i rp-i-queue" aria-hidden="true"></i></button>
      <span class="rp-muted"><i class="rp-i rp-i-volume" aria-hidden="true"></i></span>
      <input class="rp-vol" type="range" min="0" max="1" step="0.02" :value="player.volume" aria-label="Volumen"
             @input="setVolume(($event.target as HTMLInputElement).valueAsNumber)" />
    </div>
    <p v-if="player.error" class="rp-perror">{{ player.error }}</p>

    <LyricsPanel v-if="showLyrics" @close="showLyrics = false" />
    <aside v-if="showQueue" class="rp-queue" aria-label="Cola">
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
import { hasNext, hasPrev, jump, next, nowPlaying as song, player, prev, removeAt, seekTo, setVolume, toggle, toggleRepeat, toggleShuffle } from '../lib/player'
import { useStore } from '../lib/store'
import LyricsPanel from './LyricsPanel.vue'

const { go } = useStore()
const showQueue = ref(false)
const showLyrics = ref(false)
/** Where the title leads: the album the song is on (a loose song's own row is not a page). */
const albumOfSong = computed(() => song.value?.albumId || (song.value?.releaseId && song.value.releaseId > 0 ? song.value.releaseId : 0))
// ---- the progress bar: click, or press and drag (it jumps there on release, so the sound does not stutter) ----
const dragAt = ref<number | null>(null)
const playedFraction = computed(() => (player.duration ? Math.min(1, player.time / player.duration) : 0))
const shownFraction = computed(() => dragAt.value ?? playedFraction.value)
const shownTime = computed(() => (dragAt.value !== null ? dragAt.value * player.duration : player.time))
function fractionAt(e: PointerEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
}
function dragStart(e: PointerEvent) {
  if (!player.duration || e.button > 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragAt.value = fractionAt(e)
}
function dragMove(e: PointerEvent) {
  if (dragAt.value !== null) dragAt.value = fractionAt(e)
}
function dragEnd(e: PointerEvent) {
  if (dragAt.value === null) return
  seekTo(fractionAt(e))
  dragAt.value = null
}
function seekKey(e: KeyboardEvent) {
  if (!player.duration || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
  e.preventDefault()
  e.stopPropagation()
  seekTo((player.time + (e.key === 'ArrowRight' ? 5 : -5)) / player.duration)
}
</script>
