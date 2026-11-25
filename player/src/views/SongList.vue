<template>
  <ol class="rp-tracks rp-songlist">
    <li v-for="(s, i) in songs" :key="s.key" :class="{ on: nowPlaying?.key === s.key }" @dblclick="play(songs, s)">
      <button class="rp-tplay" :title="nowPlaying?.key === s.key && player.playing ? 'Pausar' : 'Reproducir'" @click="play(songs, s)">
        <img v-if="covers && s.cover" :src="s.cover" alt="" class="rp-tcover" loading="lazy" />
        <span v-else class="rp-tnum">{{ numbers ? numbers[i] : i + 1 }}</span>
        <span class="rp-ticon"><i :class="['rp-i', nowPlaying?.key === s.key && player.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i></span>
      </button>
      <span class="rp-tinfo">
        <span class="rp-ellipsis">{{ s.title }}</span>
        <small v-if="showArtist || showAlbum" class="rp-muted rp-ellipsis">
          <template v-if="showArtist && s.artist"><a href="#" @click.prevent="toArtist(s)">{{ s.artist }}</a></template>
          <template v-if="showArtist && showAlbum && s.artist && s.album"> · </template>
          <template v-if="showAlbum && s.album"><a href="#" @click.prevent="toAlbum(s)">{{ s.album }}</a></template>
        </small>
      </span>
      <span class="rp-tright">
        <span v-if="s.device && cloudMark" class="rp-muted rp-tiny" title="En este equipo"><i class="rp-i rp-i-computer" aria-hidden="true"></i></span>
        <AddToDeviceList :songs="[s]" small class="rp-hover" />
        <button v-if="removable" class="rp-mini rp-hover" :title="removeLabel" :aria-label="removeLabel" @click="emit('remove', s, i)"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
        <span v-if="extra" class="rp-muted rp-small rp-tdate">{{ extra(s, i) }}</span>
        <span class="rp-muted rp-small rp-tdur">{{ fmtTime(s.duration) }}</span>
      </span>
    </li>
  </ol>
</template>

<script setup lang="ts">
import { fmtTime, type Song } from '../lib/library'
import { nowPlaying, play, player } from '../lib/player'
import { useStore } from '../lib/store'
import AddToDeviceList from './AddToDeviceList.vue'

/** Songs from anywhere (this device, the cloud, a list of yours): play, like, add to a list of yours. */
withDefaults(defineProps<{
  songs: Song[]
  showArtist?: boolean
  showAlbum?: boolean
  /** the cover instead of the number */
  covers?: boolean
  /** the number of each (an album: its track numbers) */
  numbers?: number[]
  removable?: boolean
  removeLabel?: string
  /** a word before the duration (a date, a count) */
  extra?: (s: Song, i: number) => string
  /** mark the songs of this device (in a list that mixes them with the cloud's) */
  cloudMark?: boolean
}>(), { showArtist: true, showAlbum: true, covers: false, removable: false, removeLabel: 'Quitar', cloudMark: false })
const emit = defineEmits<{ remove: [Song, number] }>()
const { go } = useStore()

function toArtist(s: Song) {
  if (s.device || !s.artistId) go({ v: 'lartist', name: s.artistName || s.artist })
  else go({ v: 'artist', id: s.artistId })
}
function toAlbum(s: Song) {
  if (s.device && s.albumKey) go({ v: 'lalbum', key: s.albumKey })
  else if (s.albumId) go({ v: 'release', id: s.albumId })
  else if (s.releaseId && s.releaseId > 0) go({ v: 'release', id: s.releaseId })
}
</script>
