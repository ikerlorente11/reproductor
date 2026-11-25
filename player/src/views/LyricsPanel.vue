<template>
  <aside class="rp-lyrics" aria-label="Letra">
    <header class="rp-lyrics-head">
      <img v-if="song?.cover" :src="song.cover" alt="" class="rp-lyrics-cover" />
      <span v-else class="rp-lyrics-cover rp-cover-none"><i class="rp-i rp-i-album" aria-hidden="true"></i></span>
      <span class="rp-lyrics-title">
        <small class="rp-lyrics-kicker">Letra</small>
        <strong class="rp-ellipsis">{{ song?.title }}</strong>
        <small class="rp-muted rp-ellipsis">{{ [song?.artist, song?.album].filter(Boolean).join(' · ') }}</small>
      </span>
      <span class="rp-lyrics-actions">
        <button v-if="lyrics?.synced && !adjusting" class="rp-btn rp-small" title="Adelantar o retrasar la letra si va desfasada" @click="startAdjust">Ajustar</button>
        <button class="rp-mini" title="Cerrar" aria-label="Cerrar la letra" @click="emit('close')"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
      </span>
    </header>
    <div ref="box" :class="['rp-lyrics-body', { 'rp-lyrics-adjusting': adjusting }]">
      <p v-if="loading" class="rp-muted"><span class="rp-spin"></span> Buscando la letra…</p>
      <p v-else-if="error" class="rp-muted">{{ error }}</p>
      <p v-else-if="!lyrics?.found" class="rp-muted">No hay letra de esta canción.</p>
      <p v-else-if="lyrics.instrumental && !lyrics.synced && !lyrics.plain" class="rp-muted">Es instrumental ♪</p>
      <ol v-else-if="lyrics.synced" class="rp-lyrics-lines">
        <li v-for="(l, i) in lyrics.synced" :key="i" :class="{ on: i === current, past: i < current }"
            :title="adjusting ? 'Esta línea es la que suena ahora' : 'Ir a ' + fmtTime(l.t + offset)" @click="adjusting ? fitLine(i) : seek(l.t + offset)">{{ l.text || '♪' }}</li>
      </ol>
      <template v-else>
        <p class="rp-muted rp-small">Ninguna fuente tiene esta letra sincronizada.</p>
        <p class="rp-lyrics-plain">{{ lyrics.plain }}</p>
      </template>
    </div>

    <section v-if="adjusting" class="rp-lyrics-adjust" aria-label="Ajustar la sincronización">
      <p class="rp-muted rp-small">Toca la línea que está sonando ahora para encajarla, o muévela a mano. Se guarda para todos.</p>
      <div class="rp-lyrics-steps">
        <button class="rp-btn rp-small" title="La letra va una línea por delante: que vaya una línea más tarde" :disabled="current < 1" @click="fitLine(current - 1)">↑ Línea</button>
        <button class="rp-btn rp-small" title="Que la letra vaya medio segundo antes" @click="nudge(-0.5)">−0,5</button>
        <button class="rp-btn rp-small" title="Que la letra vaya una décima antes" @click="nudge(-0.1)">−0,1</button>
        <strong class="rp-lyrics-offset" :title="draft > 0 ? 'La letra va más tarde que como vino' : draft < 0 ? 'La letra va antes que como vino' : 'Como vino'">{{ fmtOffset(draft) }}</strong>
        <button class="rp-btn rp-small" title="Que la letra vaya una décima después" @click="nudge(0.1)">+0,1</button>
        <button class="rp-btn rp-small" title="Que la letra vaya medio segundo después" @click="nudge(0.5)">+0,5</button>
        <button class="rp-btn rp-small" title="La letra va una línea por detrás: que vaya una línea antes" :disabled="!lyrics?.synced || current >= lyrics.synced.length - 1" @click="fitLine(current + 1)">Línea ↓</button>
      </div>
      <div class="rp-lyrics-steps">
        <button class="rp-btn rp-small" :disabled="!draft" @click="draft = 0">Como vino</button>
        <span class="rp-grow"></span>
        <button class="rp-btn rp-small" :disabled="saving" @click="cancelAdjust">Cancelar</button>
        <button class="rp-btn rp-small rp-primary" :disabled="saving" @click="saveAdjust"><span v-if="saving" class="rp-spin"></span> Guardar</button>
      </div>
    </section>
    <p v-else-if="lyrics?.source" class="rp-muted rp-tiny rp-lyrics-src">
      Letra de {{ lyrics.source }}<template v-if="lyrics.synced && lyrics.offset"> · ajustada {{ fmtOffset(lyrics.offset) }}</template>
    </p>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Lyrics } from '../lib/api'
import { fmtTime } from '../lib/library'
import { nowPlaying as song, player, seekTo } from '../lib/player'
import { useStore } from '../lib/store'

const emit = defineEmits<{ close: [] }>()
const { api, notify } = useStore()
const lyrics = ref<Lyrics | null>(null)
const loading = ref(false)
const error = ref('')
const box = ref<HTMLElement>()
let seq = 0

async function load() {
  const s = song.value
  lyrics.value = null
  error.value = ''
  adjusting.value = false
  if (!s) return
  const mine = ++seq
  loading.value = true
  try {
    const got = await api.lyrics(s.artist, s.title, s.album, s.duration || player.duration, s.trackId)
    if (mine === seq) lyrics.value = got
  } catch (err: any) {
    if (mine === seq) error.value = `No se pudo traer la letra: ${err?.message || err}`
  } finally {
    if (mine === seq) loading.value = false
  }
}

// ---- shifting the lyrics by hand (the same for everyone): while adjusting, the draft plays live ----
const adjusting = ref(false)
const draft = ref(0)
const saving = ref(false)
const offset = computed(() => (adjusting.value ? draft.value : lyrics.value?.offset || 0))
const round = (s: number) => Math.round(s * 100) / 100
const fmtOffset = (s: number) => (s ? `${s > 0 ? '+' : '−'}${Math.abs(s).toFixed(Math.round(Math.abs(s) * 100) % 10 ? 2 : 1).replace('.', ',')} s` : 'sin ajuste')
function startAdjust() { draft.value = lyrics.value?.offset || 0; adjusting.value = true }
function cancelAdjust() { adjusting.value = false }
function nudge(by: number) { draft.value = Math.max(-60, Math.min(60, round(draft.value + by))) }
/** This line is the one being sung now. */
function fitLine(i: number) {
  const line = lyrics.value?.synced?.[i]
  if (line) draft.value = Math.max(-60, Math.min(60, round(player.time - line.t)))
}
async function saveAdjust() {
  const l = lyrics.value
  if (!l?.source) return
  saving.value = true
  try {
    const r = await api.setLyricsOffset(l.key, l.source, draft.value)
    l.offset = r.offset
    adjusting.value = false
    notify(r.offset ? `Letra ajustada ${fmtOffset(r.offset)} para todos.` : 'Letra como vino, para todos.')
  } catch (err: any) {
    notify(`No se pudo guardar el ajuste: ${err?.message || err}`, true)
  } finally {
    saving.value = false
  }
}

watch(() => song.value?.key, load, { immediate: true })

// The line being sung: the last one that has started (a hair early, as it shows up on screen).
const current = computed(() => {
  const lines = lyrics.value?.synced
  if (!lines) return -1
  const t = player.time + 0.25 - offset.value
  let i = -1
  for (let j = 0; j < lines.length && lines[j].t <= t; j++) i = j
  return i
})
watch(current, async (i) => {
  await nextTick()
  const el = box.value?.querySelectorAll('.rp-lyrics-lines li')[Math.max(0, i)] as HTMLElement | undefined
  // The sung line in the middle of the window.
  if (el && box.value) box.value.scrollTo({ top: el.offsetTop - box.value.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' })
})
function seek(t: number) { if (player.duration) seekTo(Math.max(0, t) / player.duration) }
</script>
