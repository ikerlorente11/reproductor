<template>
  <section class="rp-page rp-libpage">
    <header class="rp-libpage-head">
      <h1 class="rp-h1">Tu biblioteca</h1>
      <span class="rp-grow"></span>
      <button :class="['rp-iconbtn', { on: searching }]" aria-label="Buscar en tu biblioteca" @click="toggleSearch"><i class="rp-i rp-i-search" aria-hidden="true"></i></button>
      <button class="rp-iconbtn" aria-label="Nueva lista" @click="startCreate"><i class="rp-i rp-i-add" aria-hidden="true"></i></button>
      <span v-if="pinned.length" class="rp-libpage-more">
        <button :class="['rp-iconbtn', { on: moreOpen }]" aria-label="Traer música" aria-haspopup="menu" :aria-expanded="moreOpen" @click="moreOpen = !moreOpen">
          <i class="rp-i rp-i-download" aria-hidden="true"></i>
        </button>
        <div v-if="moreOpen" class="rp-menu-backdrop" @click="moreOpen = false"></div>
        <div v-if="moreOpen" class="rp-menu" role="menu">
          <p class="rp-menu-head rp-muted rp-small">Traer música</p>
          <button v-for="x in pinned" :key="x.key" class="rp-menu-item rp-libpage-more-item" role="menuitem" @click="moreOpen = false; go(x.view)">
            <span class="rp-librow-pinned"><i :class="['rp-i', x.icon]" aria-hidden="true"></i></span>
            <span class="rp-librow-text"><span>{{ x.name }}</span><small class="rp-muted">{{ x.note }}</small></span>
          </button>
        </div>
      </span>
    </header>
    <div class="rp-chips rp-libpage-chips" role="tablist">
      <button v-for="k in kinds" :key="k.key" :class="['rp-chip', { on: show === k.key }]" role="tab" :aria-selected="show === k.key"
              @click="go({ v: 'library', ...(show === k.key ? {} : { show: k.key }) }, true)">{{ k.label }}</button>
    </div>
    <input v-if="searching" ref="searchInput" v-model="filter" class="rp-input rp-libpage-filter" type="search" placeholder="Buscar en tu biblioteca"
           @keydown.esc="toggleSearch" />
    <form v-if="creating" class="rp-libpage-new" @submit.prevent="create">
      <input ref="newInput" v-model="newName" class="rp-input" placeholder="Nombre de la lista" maxlength="120" @keydown.esc="creating = false" />
      <button class="rp-btn rp-primary" :disabled="!newName.trim()">Crear</button>
    </form>

    <section v-for="g in groups" :key="g.kind" class="rp-libgroup">
    <h2 v-if="groups.length > 1" class="rp-h2 rp-libgroup-head">{{ g.label }}</h2>
    <ul class="rp-librows">
      <li v-for="e in g.rows" :key="e.kind + e.key">
        <a href="#" @click.prevent="go(e.view)">
          <img v-if="e.picture" :src="e.picture" alt="" :class="['rp-librow-pic', { round: e.kind === 'artist' }]" loading="lazy" />
          <span v-else :class="['rp-librow-pic', { round: e.kind === 'artist' }]">
            <i :class="['rp-i', e.kind === 'artist' ? 'rp-i-artist' : e.kind === 'list' ? 'rp-i-playlist' : e.device ? 'rp-i-phone' : 'rp-i-folder']" aria-hidden="true"></i>
          </span>
          <span class="rp-librow-text">
            <span class="rp-ellipsis">{{ e.name }}</span>
            <small class="rp-muted rp-ellipsis">{{ e.note || kindName[e.kind] }}</small>
          </span>
        </a>
      </li>
    </ul>
    </section>
    <p v-if="!loaded" class="rp-muted"><span class="rp-spin"></span> Cargando…</p>
    <p v-else-if="!groups.length" class="rp-muted rp-libpage-none">
      <template v-if="filter.trim()">Nada con «{{ filter.trim() }}».</template>
      <template v-else-if="show === 'lists'">Aún no tienes listas: crea una con ＋.</template>
      <template v-else>Aún no hay nada aquí.</template>
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useStore, type LibraryEntry, type View } from '../lib/store'

/** A phone's «Tu biblioteca» tab: what is in the sidebar on a wide screen (your lists, artists and folders), each kind
 *  in its own section, with chips to show only one, like the music apps people know. */
const props = defineProps<{
  show?: string
  artists: LibraryEntry[]
  lists: LibraryEntry[]
  folders: LibraryEntry[]
  loaded: boolean
  /** the pages that have no tab of their own (Descargar música, Traer tu Spotify…), behind a button of the header */
  pinned: { key: string; name: string; note: string; icon: string; view: View }[]
  /** makes a new list with this name */
  create: (name: string) => Promise<void> | void
}>()
const { go } = useStore()
type Kind = 'list' | 'artist' | 'folder'
const kindName: Record<Kind, string> = { list: 'Lista', artist: 'Artista', folder: 'Carpeta' }
const kinds = computed(() => [
  { key: 'lists', label: 'Listas', n: props.lists.length },
  { key: 'artists', label: 'Artistas', n: props.artists.length },
  { key: 'folders', label: 'Carpetas', n: props.folders.length }
].filter((k) => k.n > 0 || k.key === 'lists'))

const searching = ref(false)
const filter = ref('')
const searchInput = ref<HTMLInputElement>()
function toggleSearch() {
  searching.value = !searching.value
  filter.value = ''
  if (searching.value) nextTick(() => searchInput.value?.focus())
}
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const groups = computed(() => {
  const q = plain(filter.value.trim())
  const all: { kind: Kind; show: string; label: string; entries: LibraryEntry[] }[] = [
    { kind: 'list', show: 'lists', label: 'Listas', entries: props.lists },
    { kind: 'artist', show: 'artists', label: 'Artistas', entries: props.artists },
    { kind: 'folder', show: 'folders', label: 'Carpetas', entries: props.folders }
  ]
  return all.filter((g) => !props.show || props.show === g.show)
    .map((g) => ({ ...g, rows: g.entries.filter((e) => !q || plain(e.name).includes(q)).map((e) => ({ ...e, kind: g.kind })) }))
    .filter((g) => g.rows.length)
})
const moreOpen = ref(false)

const creating = ref(false)
const newName = ref('')
const newInput = ref<HTMLInputElement>()
function startCreate() {
  creating.value = !creating.value
  if (creating.value) nextTick(() => newInput.value?.focus())
}
async function create() {
  const name = newName.value.trim()
  if (!name) return
  await props.create(name)
  newName.value = ''
  creating.value = false
}
</script>
