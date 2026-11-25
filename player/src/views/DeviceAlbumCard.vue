<template>
  <article class="rp-card rp-card-link">
    <div class="rp-cover" @click="go({ v: 'lalbum', key: album.key })">
      <img v-if="cover" :src="cover" alt="" loading="lazy" />
      <span v-else class="rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
      <button class="rp-cover-play" title="Reproducir" @click.stop="play(device!.songs(album.tracks), null, false)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
    </div>
    <div class="rp-card-text" @click="go({ v: 'lalbum', key: album.key })">
      <strong class="rp-ellipsis" :title="album.title">{{ album.title || 'Sin disco' }}</strong>
      <span class="rp-muted rp-small rp-ellipsis">{{ subtitle }}</span>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DeviceAlbum } from '../lib/device'
import { play } from '../lib/player'
import { useStore } from '../lib/store'

/** An album of this device in a grid: open it, or play it at once. */
const props = withDefaults(defineProps<{ album: DeviceAlbum; showArtist?: boolean }>(), { showArtist: true })
const { device, go } = useStore()
const cover = computed(() => device?.cover(props.album.cover) || null)
const subtitle = computed(() => [props.showArtist ? props.album.artist : '', props.album.year || '',
  props.showArtist ? '' : `${props.album.tracks.length} ${props.album.tracks.length === 1 ? 'canción' : 'canciones'}`].filter(Boolean).join(' · '))
</script>
