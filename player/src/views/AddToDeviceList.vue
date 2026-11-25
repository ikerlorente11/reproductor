<template>
  <span ref="root" class="rp-add">
    <button :class="small ? 'rp-mini rp-add-mini' : 'rp-btn'" :title="title" :aria-label="title" :aria-expanded="open" @click.stop="toggle">
      <template v-if="small"><i class="rp-i rp-i-add" aria-hidden="true"></i></template><template v-else><i class="rp-i rp-i-add" aria-hidden="true"></i> Añadir a lista</template>
    </button>
    <div v-if="open" class="rp-menu" role="menu" @click.stop>
      <p class="rp-menu-head rp-muted rp-small">Añadir {{ what }} a…</p>
      <button v-for="l in mine.lists" :key="l.id" class="rp-menu-item" role="menuitem" @click="add(l.id)">
        <i class="rp-i rp-i-playlist" aria-hidden="true"></i> <span class="rp-ellipsis">{{ l.name }}</span>
      </button>
      <form class="rp-menu-new" @submit.prevent="create">
        <input v-model="newName" class="rp-input" placeholder="Nueva lista…" maxlength="120" aria-label="Nombre de la lista nueva" />
        <button class="rp-btn rp-small rp-primary" :disabled="!newName.trim()">Crear</button>
      </form>
    </div>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Song } from '../lib/library'
import { addToList, createList, listById, mine } from '../lib/mine'
import { useStore } from '../lib/store'

/** Adds songs (one, an album, an artist's) to a playlist of yours, or to a new one. */
const props = withDefaults(defineProps<{ songs: Song[]; small?: boolean }>(), { small: false })
const { notify } = useStore()
const root = ref<HTMLElement>()
const open = ref(false)
const newName = ref('')
const what = computed(() => (props.songs.length === 1 ? 'la canción' : `${props.songs.length} canciones`))
const title = computed(() => `Añadir ${what.value} a una lista`)

function onOutside(e: MouseEvent) { if (root.value && !root.value.contains(e.target as Node)) close() }
function close() { open.value = false; document.removeEventListener('click', onOutside) }
function toggle() {
  if (open.value) return close()
  open.value = true
  document.addEventListener('click', onOutside)
}
function add(id: string) {
  const n = addToList(id, props.songs)
  const name = listById(id)?.name || ''
  notify(n ? `Añadida${n === 1 ? '' : 's'} a «${name}».` : `Ya estaba${props.songs.length === 1 ? '' : 'n'} en «${name}».`)
  close()
}
function create() {
  const list = createList(newName.value, props.songs)
  newName.value = ''
  notify(`Lista «${list.name}» creada.`)
  close()
}
onBeforeUnmount(() => document.removeEventListener('click', onOutside))
</script>
