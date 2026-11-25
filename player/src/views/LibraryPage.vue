<template>
  <section class="rp-page rp-libpage">
    <header class="rp-libpage-head">
      <h1 class="rp-h1">Tu biblioteca</h1>
      <span class="rp-grow"></span>
      <button :class="['rp-iconbtn', { on: searching }]" aria-label="Buscar en tu biblioteca" @click="toggleSearch"><i class="rp-i rp-i-search" aria-hidden="true"></i></button>
      <button class="rp-iconbtn" aria-label="Nueva lista" @click="startCreate"><i class="rp-i rp-i-add" aria-hidden="true"></i></button>
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

    <ul class="rp-librows">
      <li v-for="x in pinned" :key="x.key">
        <a href="#" @click.prevent="go(x.view)">
          <span class="rp-librow-pic rp-librow-pinned"><i :class="['rp-i', x.icon]" aria-hidden="true"></i></span>
          <span class="rp-librow-text"><span class="rp-ellipsis">{{ x.name }}</span><small class="rp-muted rp-ellipsis">{{ x.note }}</small></span>
        </a>
      </li>
      <li v-for="e in rows" :key="e.kind + e.key">
        <a href="#" @click.prevent="go(e.view)">
          <img v-if="e.picture" :src="e.picture" alt="" :class="['rp-librow-pic', { round: e.kind === 'artist' }]" loading="lazy" />
          <span v-else :class="['rp-librow-pic', { round: e.kind === 'artist' }]">
            <i :class="['rp-i', e.kind === 'artist' ? 'rp-i-artist' : e.kind === 'list' ? 'rp-i-playlist' : e.device ? 'rp-i-phone' : 'rp-i-folder']" aria-hidden="true"></i>
          </span>
          <span class="rp-librow-text">
            <span class="rp-ellipsis">{{ e.name }}</span>
            <small class="rp-muted rp-ellipsis">{{ kindName[e.kind] }}<template v-if="e.note"> · {{ e.note }}</template></small>
          </span>
        </a>
      </li>
    </ul>
    <p v-if="!loaded" class="rp-muted"><span class="rp-spin"></span> Cargando…</p>
    <p v-else-if="!rows.length" class="rp-muted rp-libpage-none">
      <template v-if="filter.trim()">Nada con «{{ filter.trim() }}».</template>
      <template v-else-if="show === 'lists'">Aún no tienes listas: crea una con ＋.</template>
      <template v-else>Aún no hay nada aquí.</template>
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useStore, type View } from '../lib/store'

/** A phone's «Tu biblioteca» tab: what is in the sidebar on a wide screen (your lists, artists and folders), as one
 *  list with chips to narrow it, like the music apps people know. */
export interface LibraryEntry { key: string; name: string; note?: string; picture?: string | null; view: View; device?: boolean; title?: string }
const props = defineProps<{
  show?: string
  artists: LibraryEntry[]
  lists: LibraryEntry[]
  folders: LibraryEntry[]
  loaded: boolean
  /** the pages that have no tab of their own (Descargar música, Traer tu Spotify…), pinned at the top */
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

const rows = computed(() => {
  const q = plain(filter.value.trim())
  const all: (LibraryEntry & { kind: Kind })[] = [
    ...(!props.show || props.show === 'lists' ? props.lists.map((e) => ({ ...e, kind: 'list' as const })) : []),
    ...(!props.show || props.show === 'artists' ? props.artists.map((e) => ({ ...e, kind: 'artist' as const })) : []),
    ...(!props.show || props.show === 'folders' ? props.folders.map((e) => ({ ...e, kind: 'folder' as const })) : [])
  ]
  return q ? all.filter((e) => plain(e.name).includes(q)) : all
})
const pinned = computed(() => (props.show || filter.value.trim() ? [] : props.pinned))

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
