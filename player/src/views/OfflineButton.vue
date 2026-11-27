<template>
  <!-- one round button, as Spotify's download one: empty (not here), its number of songs missing, turning while it saves,
       full and green once it is all here -->
  <button v-if="offline && paths.length && busy" class="rp-act on" :title="`Guardando en este equipo: ${done} de ${paths.length}`"
          :aria-label="`Guardando en este equipo: ${done} de ${paths.length}`" disabled>
    <span class="rp-spin"></span><span class="rp-act-count">{{ done }}/{{ paths.length }}</span>
  </button>
  <button v-else-if="offline && paths.length && done === paths.length" class="rp-act on"
          :title="`En este equipo: suena sin conexión${kept ? ' (y lo que se añada se guarda solo)' : ''}. Pulsa para quitar la copia (no se borra de tu nube)`"
          aria-label="En este equipo: quitar la copia" @click="drop">
    <i class="rp-i rp-i-saved" aria-hidden="true"></i>
  </button>
  <button v-else-if="offline && paths.length" class="rp-act"
          :title="done ? `Tienes ${done} de ${paths.length} en este equipo: guardar lo que falta` : 'Guardar en este equipo, para escucharlo sin conexión'"
          :aria-label="done ? `Guardar lo que falta (${paths.length - done})` : 'Guardar en este equipo'" @click="save">
    <i class="rp-i rp-i-save" aria-hidden="true"></i><span v-if="done" class="rp-act-count">{{ paths.length - done }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { ask } from '../lib/ask'
import { useStore } from '../lib/store'

/** An album's or a playlist's songs kept on this device (an app connected to a server). A playlist's can also be «kept»
 *  (what is added to it later comes down by itself): that option is in its «⋯» (PlaylistView, `keepList`). */
const props = defineProps<{ paths: string[]; listId?: number }>()
const { offline, notify } = useStore()
const done = computed(() => props.paths.filter((p) => offline?.has(p)).length)
const kept = computed(() => !!props.listId && !!offline?.isKept(props.listId))
const busy = computed(() => !!offline && props.paths.some((p) => offline.state.queued.has(p)))
watch(() => props.paths.join('\n'), () => { offline?.check(props.paths).catch(() => {}) }, { immediate: true })

async function save() {
  try {
    const n = await offline!.download(props.paths)
    if (n) notify(`Guardando ${n} ${n === 1 ? 'canción' : 'canciones'} en este equipo.`)
  } catch (err: any) { notify(err?.message || String(err), true) }
}
async function drop() {
  if (!(await ask('¿Quitar la copia de este equipo? Sigue en tu nube; solo deja de sonar sin conexión.', 'Quitar', true))) return
  if (props.listId) offline!.setKept(props.listId, false)
  try { await offline!.remove(props.paths); notify('Copia quitada de este equipo.') } catch (err: any) { notify(err?.message || String(err), true) }
}
</script>

<script lang="ts">
import type { Offline } from '../lib/offline'
/** A playlist kept on the device (on: it saves what it lacks now, and what is added later by itself). */
export async function keepList(offline: Offline, listId: number, paths: string[], on: boolean, notify: (text: string, error?: boolean) => void) {
  offline.setKept(listId, on)
  if (!on) return
  try {
    const n = await offline.download(paths)
    if (n) notify(`Guardando ${n} ${n === 1 ? 'canción' : 'canciones'} en este equipo.`)
  } catch (err: any) { notify(err?.message || String(err), true) }
}
</script>
