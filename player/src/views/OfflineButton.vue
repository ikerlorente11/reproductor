<template>
  <span v-if="offline && paths.length" class="rp-offline">
    <button v-if="busy" class="rp-btn" disabled :title="`Guardando en este equipo: ${done} de ${paths.length}`">
      <span class="rp-spin"></span> En este equipo {{ done }}/{{ paths.length }}
    </button>
    <button v-else-if="done === paths.length" class="rp-btn rp-on" title="Está en este equipo: suena sin conexión. Pulsa para quitar la copia (no se borra de tu nube)" @click="drop">
      <i class="rp-i rp-i-computer" aria-hidden="true"></i> En este equipo
    </button>
    <button v-else class="rp-btn" :title="done ? `Tienes ${done} de ${paths.length} en este equipo` : 'Guardar una copia en este equipo para escucharlo sin conexión'" @click="save">
      <i class="rp-i rp-i-download" aria-hidden="true"></i> {{ done ? `Guardar lo que falta (${paths.length - done})` : 'Guardar en este equipo' }}
    </button>
    <label v-if="listId" class="rp-check rp-small" title="Lo que se añada a la lista se guardará solo en este equipo">
      <input type="checkbox" :checked="offline.isKept(listId)" @change="keep(($event.target as HTMLInputElement).checked)" /> Mantener guardada
    </label>
  </span>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useStore } from '../lib/store'

/** An album's or a playlist's songs kept on this device (an app connected to a server). */
const props = defineProps<{ paths: string[]; listId?: number }>()
const { offline, notify } = useStore()
const done = computed(() => props.paths.filter((p) => offline?.has(p)).length)
const busy = computed(() => !!offline && props.paths.some((p) => offline.state.queued.has(p)))
watch(() => props.paths.join('\n'), () => { offline?.check(props.paths).catch(() => {}) }, { immediate: true })

async function save() {
  try {
    const n = await offline!.download(props.paths)
    if (n) notify(`Guardando ${n} ${n === 1 ? 'canción' : 'canciones'} en este equipo.`)
  } catch (err: any) { notify(err?.message || String(err), true) }
}
async function drop() {
  if (!window.confirm('¿Quitar la copia de este equipo? Sigue en tu nube; solo deja de sonar sin conexión.')) return
  if (props.listId) offline!.setKept(props.listId, false)
  try { await offline!.remove(props.paths); notify('Copia quitada de este equipo.') } catch (err: any) { notify(err?.message || String(err), true) }
}
function keep(on: boolean) {
  offline!.setKept(props.listId!, on)
  if (on) save()
}
</script>
