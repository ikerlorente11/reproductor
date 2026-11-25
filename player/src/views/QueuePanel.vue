<template>
  <section class="rp-panel rp-queuepanel" aria-label="Cola">
    <header class="rp-panel-head">
      <span class="rp-panel-title"><small class="rp-panel-kicker">Cola</small><strong>{{ player.index + 1 }} de {{ player.queue.length }}</strong></span>
      <button class="rp-mini" title="Cerrar" aria-label="Cerrar la cola" @click="emit('close')"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
    </header>
    <div ref="box" class="rp-panel-body">
      <p v-if="!player.queue.length" class="rp-muted">No hay nada en la cola.</p>
      <ol v-else class="rp-queuelist">
        <li v-for="(s, i) in player.queue" :key="s.key + i" :class="{ on: i === player.index, past: i < player.index }" @click="jump(i)">
          <img v-if="s.cover" :src="s.cover" alt="" class="rp-queuelist-cover" loading="lazy" />
          <span v-else class="rp-queuelist-cover rp-cover-none"><i class="rp-i rp-i-music" aria-hidden="true"></i></span>
          <span class="rp-tinfo"><span class="rp-ellipsis">{{ s.title }}</span><small class="rp-muted rp-ellipsis">{{ s.artist }}</small></span>
          <i v-if="i === player.index" class="rp-i rp-i-music rp-queuelist-now" aria-label="La que suena"></i>
          <button v-else class="rp-mini" title="Quitar de la cola" aria-label="Quitar de la cola" @click.stop="removeAt(i)"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
        </li>
      </ol>
    </div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { jump, player, removeAt } from '../lib/player'

/** What comes next (and what played): touch a song to play it, ✕ to take it out. A panel in the page's place (a wide
 *  screen) or in the cover's (a phone's player). */
const emit = defineEmits<{ close: [] }>()
const box = ref<HTMLElement>()
// opened at the song that plays
onMounted(() => nextTick(() => box.value?.querySelector('li.on')?.scrollIntoView({ block: 'center' })))
</script>
