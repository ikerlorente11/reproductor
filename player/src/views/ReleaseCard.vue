<template>
  <article :class="['rp-card', `rp-st-${release.status}`, { 'rp-card-link': selecting ? selectable : openable, 'rp-card-sel': selected, 'rp-card-off': selecting && !selectable }]"
           @click="selectable && emit('select', $event)">
    <div class="rp-cover" @click="!selecting && openable && emit('open')">
      <span v-if="selectable" class="rp-card-check"><input type="checkbox" :checked="selected" :aria-label="`Seleccionar «${release.title}»`" @click.stop="emit('select', $event)" /></span>
      <img v-if="release.cover" :src="release.cover" alt="" loading="lazy" />
      <span v-else class="rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
      <button v-if="playable && !selectable" class="rp-cover-play" title="Reproducir" @click.stop="emit('play')"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
    </div>
    <div class="rp-card-text" @click="!selecting && openable && emit('open')">
      <strong class="rp-ellipsis" :title="release.title">{{ release.title }}</strong>
      <span class="rp-muted rp-small rp-ellipsis">{{ subtitle }}</span>
      <span v-if="badge && release.status === 'preview-pending'" class="rp-skel rp-skel-badge" aria-label="Calculando"></span>
      <span v-else-if="badge" :class="['rp-badge', `rp-badge-${release.status}`]" :title="label.hint">{{ label.text }}</span>
      <span v-if="label.hint && release.status !== 'done'" class="rp-muted rp-tiny rp-ellipsis" :title="label.hint">{{ label.hint }}</span>
    </div>
    <div v-if="$slots.default && !selecting" class="rp-card-actions"><slot /></div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Release } from '../lib/api'
import { albumOf, kindLabel, statusLabel, fmtDate } from '../lib/library'

/** `selecting`: the grid is choosing releases; `selectable`: this one can be chosen (it is downloaded). */
const props = withDefaults(defineProps<{ release: Release; showArtist?: boolean; badge?: boolean; selecting?: boolean; selectable?: boolean; selected?: boolean }>(),
                           { showArtist: false, badge: true, selecting: false, selectable: false, selected: false })
const emit = defineEmits<{ open: []; play: []; select: [MouseEvent] }>()

const label = computed(() => statusLabel(props.release))
const playable = computed(() => props.release.status === 'done' && (props.release.files || []).some((f) => f.path))
const openable = computed(() => albumOf(props.release) > 0)
const subtitle = computed(() => {
  const r = props.release
  const parts = props.showArtist ? [r.artist_name || '', fmtDate(r.date)] : [fmtDate(r.date), kindLabel(r.kind)]
  return parts.filter(Boolean).join(' · ')
})
</script>
