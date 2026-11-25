<template>
  <section class="rp-page">
    <p v-if="kind === 'list' && !list" class="rp-muted">Esta lista ya no existe.</p>
    <template v-else>
      <header class="rp-hero">
        <span class="rp-hero-pic rp-cover-none rp-hero-mine"><i :class="['rp-i', icon]" aria-hidden="true"></i></span>
        <div class="rp-hero-text">
          <span class="rp-muted rp-small">{{ kind === 'list' ? 'Lista' : 'Tu música' }}</span>
          <form v-if="renaming" @submit.prevent="rename"><input ref="nameInput" v-model="newName" class="rp-input rp-h1" maxlength="120" @keydown.esc="renaming = false" @blur="rename" /></form>
          <h1 v-else class="rp-h1 rp-big" :title="kind === 'list' ? 'Doble clic para cambiar el nombre' : undefined" @dblclick="startRename">{{ heading }}</h1>
          <span class="rp-muted rp-small">{{ songs.length }} {{ songs.length === 1 ? 'canción' : 'canciones' }}</span>
          <div class="rp-hero-actions">
            <button class="rp-btn rp-primary rp-round-btn" :disabled="!songs.length" title="Reproducir" @click="play(songs, null, false)"><i class="rp-i rp-i-play" aria-hidden="true"></i></button>
            <button class="rp-btn" :disabled="!songs.length" @click="play(songs, null, true)"><i class="rp-i rp-i-shuffle" aria-hidden="true"></i> Aleatorio</button>
            <template v-if="kind === 'list'">
              <button class="rp-btn" @click="startRename">Cambiar nombre</button>
              <button class="rp-btn rp-danger" @click="remove"><i class="rp-i rp-i-delete" aria-hidden="true"></i> Borrar la lista</button>
            </template>
          </div>
        </div>
      </header>
      <p v-if="!songs.length" class="rp-muted">{{ empty }}</p>
      <SongList v-else :songs="songs" covers cloud-mark :removable="kind !== 'recent'" :remove-label="kind === 'likes' ? 'Quitar de Me gusta' : 'Quitar de la lista'"
                :extra="kind === 'recent' ? (_s, i) => when(history[i]) : undefined" @remove="drop" />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ask } from '../lib/ask'
import type { Song } from '../lib/library'
import { deleteList, listById, mine, recentSongs, removeFromList, renameList, toggleLike } from '../lib/mine'
import { play } from '../lib/player'
import { useStore } from '../lib/store'
import SongList from './SongList.vue'

/** Your songs: the ones you like, the ones you listened to lately, or one of your playlists. */
const props = defineProps<{ kind: 'likes' | 'recent' | 'list'; id?: string }>()
const { go, notify } = useStore()
const list = computed(() => (props.id ? listById(props.id) : undefined))
const icon = { likes: 'rp-i-heart-fill', recent: 'rp-i-time', list: 'rp-i-playlist' }[props.kind]
const heading = computed(() => (props.kind === 'likes' ? 'Me gusta' : props.kind === 'recent' ? 'Escuchado hace poco' : list.value?.name || ''))
const empty = { likes: 'Pulsa el corazón de una canción y aparecerá aquí.', recent: 'Aún no has escuchado nada.', list: 'La lista está vacía: añade canciones con ＋.' }[props.kind]
const history = computed(() => { const seen = new Set<string>(); return mine.history.filter((p) => !seen.has(p.song.key) && !!seen.add(p.song.key)).slice(0, 200) })
const songs = computed<Song[]>(() => (props.kind === 'likes' ? mine.likes.map((l) => l.song) : props.kind === 'recent' ? recentSongs(200) : list.value?.songs || []))
const when = (p?: { at: number }) => {
  if (!p) return ''
  const mins = Math.round((Date.now() - p.at) / 60000)
  return mins < 60 ? `hace ${Math.max(1, mins)} min` : mins < 1440 ? `hace ${Math.round(mins / 60)} h` : new Date(p.at).toLocaleDateString('es')
}

function drop(s: Song) {
  if (props.kind === 'likes') toggleLike(s)
  else if (props.id) removeFromList(props.id, s.key)
}
const renaming = ref(false)
const newName = ref('')
const nameInput = ref<HTMLInputElement>()
function startRename() {
  if (props.kind !== 'list' || !list.value) return
  newName.value = list.value.name
  renaming.value = true
  nextTick(() => nameInput.value?.select())
}
function rename() {
  if (props.id && renaming.value) renameList(props.id, newName.value)
  renaming.value = false
}
async function remove() {
  if (!props.id || !(await ask(`¿Borrar la lista «${list.value?.name}»? Las canciones no se tocan.`, 'Borrar', true))) return
  deleteList(props.id)
  notify('Lista borrada.')
  go({ v: 'home' })
}
</script>
