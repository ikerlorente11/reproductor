<template>
  <div class="rp-tracklist">
  <div v-if="held.length > 1 && !selecting" class="rp-tracks-tools">
    <button class="rp-btn rp-small" title="Elegir varias canciones para borrarlas a la vez" @click="selecting = true">Seleccionar</button>
  </div>
  <ol :class="['rp-tracks', { 'rp-selecting': selecting }]">
    <li v-for="(t, i) in hits" :key="t.id" :class="{ on: playingId === t.id && !selecting, off: t.have !== 'done', sel: picked.has(t.id) }"
        @dblclick="!selecting && playHit(t)" @click="selecting && t.have === 'done' && pick(t, i, $event)">
      <span v-if="selecting" class="rp-tplay rp-tcheck">
        <input v-if="t.have === 'done'" type="checkbox" :checked="picked.has(t.id)" :aria-label="`Seleccionar «${t.title}»`" @click.stop="pick(t, i, $event)" />
        <span v-else class="rp-tnum">{{ i + 1 }}</span>
      </span>
      <button v-else-if="t.have === 'done'" class="rp-tplay" :title="playingId === t.id && player.playing ? 'Pausar' : 'Reproducir'" @click="playHit(t)">
        <span class="rp-tnum">{{ i + 1 }}</span><span class="rp-ticon"><i :class="['rp-i', playingId === t.id && player.playing ? 'rp-i-pause' : 'rp-i-play']" aria-hidden="true"></i></span>
      </button>
      <span v-else class="rp-tplay rp-tnum">{{ i + 1 }}</span>
      <span class="rp-tinfo">
        <span class="rp-ellipsis" @click="phone && !selecting && t.have === 'done' && playHit(t)">{{ t.title }}</span>
        <small v-if="showArtist || showAlbum" class="rp-muted rp-ellipsis">
          <a v-if="showArtist && t.artist_id" href="#" @click.prevent="go({ v: 'artist', id: t.artist_id })">{{ t.artist_name }}</a>
          <template v-if="showArtist && showAlbum && t.album_title"> · </template>
          <a v-if="showAlbum && t.album_id" href="#" @click.prevent="go({ v: 'release', id: t.album_id })">{{ t.album_title }}</a>
        </small>
      </span>
      <span v-if="!selecting" class="rp-tright">
        <span v-if="t.have === 'coming'" class="rp-badge rp-badge-wanted rp-badge-progress" :title="comingText(t)">
          <i v-if="comingPct(t) !== null" :style="{ width: comingPct(t) + '%' }"></i><span>{{ comingText(t) }}</span></span>
        <button v-else-if="!t.have" class="rp-mini" title="Bajar esta canción" :disabled="busy.has(t.id)" @click="download(t)">
          <span v-if="busy.has(t.id)" class="rp-spin"></span><template v-else><i class="rp-i rp-i-cloud-down" aria-hidden="true"></i></template>
        </button>
        <AddToPlaylist kind="song" :id="t.id" small class="rp-hover" @added="!t.have && emit('changed')" />
        <button v-if="t.have === 'done' && t.file" class="rp-mini rp-hover rp-mini-danger" :title="`Borrar esta canción de ${where}`" aria-label="Borrar esta canción" @click="removeSong(t)">
          <i class="rp-i rp-i-delete" aria-hidden="true"></i>
        </button>
        <span v-if="offline?.has(t.file?.path)" class="rp-muted rp-tiny" title="En este equipo: suena sin conexión"><i class="rp-i rp-i-computer" aria-hidden="true"></i></span>
        <span v-if="showDate" class="rp-muted rp-small rp-tdate">{{ fmtDate((t as any).date) }}</span>
        <span class="rp-muted rp-small rp-tdur">{{ fmtTime(t.duration) }}</span>
        <button v-if="phone" class="rp-mini rp-tmore" aria-label="Más opciones" @click.stop="toggleRow"><i class="rp-i rp-i-more" aria-hidden="true"></i></button>
      </span>
      <span v-else class="rp-tright"><span class="rp-muted rp-small rp-tdur">{{ fmtTime(t.duration) }}</span></span>
    </li>
  </ol>
  <SelectionBar v-if="selecting" :count="picked.size" :total="held.length" :label="picked.size === 1 ? 'canción seleccionada' : 'canciones seleccionadas'"
                @all="held.forEach((t) => picked.add(t.id))" @none="picked.clear()" @cancel="stopSelecting" @delete="removePicked" />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Release, TrackHit } from '../lib/api'
import { downloadState, fmtDate, fmtTime, heldSongs } from '../lib/library'
import { nowPlaying, play, player } from '../lib/player'
import { useStore } from '../lib/store'
import AddToPlaylist from './AddToPlaylist.vue'
import { isPhone as phone, toggleRow } from '../lib/phone'
import SelectionBar from './SelectionBar.vue'

/** Songs of the catalogue (an album, a Deezer playlist, search results), each with what I have of it. */
const props = withDefaults(defineProps<{ hits: TrackHit[]; showArtist?: boolean; showAlbum?: boolean; showDate?: boolean }>(), { showArtist: false, showAlbum: false, showDate: false })
const emit = defineEmits<{ changed: [] }>()
const { api, state, go, notify, refreshFollows, refreshDownloads, remove, where, offline } = useStore()
const busy = reactive(new Set<number>())

// ---- choosing several songs to delete them at once (shift-click takes the stretch in between) ----
const held = computed(() => props.hits.filter((t) => t.have === 'done' && t.file))
const selecting = ref(false)
const picked = reactive(new Set<number>())
let lastPicked = -1
function pick(t: TrackHit, i: number, e: MouseEvent) {
  const on = !picked.has(t.id)
  if (e.shiftKey && lastPicked >= 0) {
    const [a, b] = lastPicked < i ? [lastPicked, i] : [i, lastPicked]
    props.hits.slice(a, b + 1).forEach((h) => { if (h.have === 'done' && h.file) on ? picked.add(h.id) : picked.delete(h.id) })
  } else if (on) picked.add(t.id)
  else picked.delete(t.id)
  lastPicked = i
}
function stopSelecting() {
  selecting.value = false
  picked.clear()
  lastPicked = -1
}
async function removePicked() {
  const chosen = held.value.filter((t) => picked.has(t.id))
  const title = chosen.length === 1 ? `¿Borrar «${chosen[0].title}»?` : `¿Borrar estas ${chosen.length} canciones?`
  if (await remove({ title, paths: chosen.map((t) => t.file?.path) })) {
    stopSelecting()
    emit('changed')
  }
}

// ---- songs on their way: how far their download is (the song alone, or the album it is on) ----
function downloadOf(t: TrackHit): Release | undefined {
  const active = state.downloads.active
  return active.find((r) => r.release_id === -t.id || r.track_id === t.id) || active.find((r) => !!t.album_id && r.release_id === t.album_id)
}
const comingPct = (t: TrackHit) => { const r = downloadOf(t); return r ? downloadState(r).pct : null }
const comingText = (t: TrackHit) => { const r = downloadOf(t); return (r && downloadState(r).text) || 'bajando' }
// One of them finished (it left the downloads on their way): the list asks again what I have.
const arriving = computed(() => props.hits.filter((t) => t.have === 'coming').map((t) => downloadOf(t)?.release_id ?? 'x').join())
watch(arriving, (now, before) => { if (before && now !== before) emit('changed') })

const songs = computed(() => heldSongs(props.hits))
const playingId = computed(() => songs.value.find((s) => s.key === nowPlaying.value?.key)?.trackId ?? null)

function playHit(t: TrackHit) {
  const song = songs.value.find((s) => s.trackId === t.id)
  if (song) play(songs.value, song)
}
async function removeSong(t: TrackHit) {
  if (await remove({ title: `¿Borrar «${t.title}»?`, paths: [t.file?.path] })) emit('changed')
}
async function download(t: TrackHit) {
  busy.add(t.id)
  try {
    await api.downloadSong(t.id)
    notify(`Bajando «${t.title}».`)
    emit('changed')
    refreshFollows()
    refreshDownloads()
  } catch (err: any) {
    notify(err?.message || String(err), true)
  } finally {
    busy.delete(t.id)
  }
}
</script>
