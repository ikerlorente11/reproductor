<template>
  <section class="rp-libs">
    <h2>Bibliotecas</h2>
    <p class="rp-muted rp-small">Añade tu servidor de música (Navidrome, Airsonic, Gonic, Ampache o cualquiera compatible con Subsonic, o Jellyfin):
      sus canciones se juntan con las de este equipo y suenan directamente desde él.</p>
    <ul v-if="state.list.length" class="rp-libs-list">
      <li v-for="c in state.list" :key="c.id">
        <i class="rp-i rp-i-cloud" aria-hidden="true"></i>
        <span class="rp-grow">
          <strong>{{ c.name }}</strong> <small class="rp-muted">{{ kindLabel(c.kind) }} · {{ c.username }}@{{ host(c.url) }}</small>
          <small v-if="state.errors[c.id]" class="rp-sl-bad rp-ellipsis">{{ state.errors[c.id] }}</small>
        </span>
        <span class="rp-muted rp-small">
          <template v-if="state.loading.includes(c.id)"><span class="rp-spin"></span> Leyendo…</template>
          <template v-else-if="state.counts[c.id] !== undefined">{{ state.counts[c.id] }} canciones</template>
        </span>
        <button class="rp-mini" title="Volver a leerla" :disabled="state.loading.includes(c.id)" @click="libraries.load(c.id)"><i class="rp-i rp-i-refresh" aria-hidden="true"></i></button>
        <button class="rp-mini" title="Quitar la biblioteca (no se borra nada del servidor)" @click="remove(c.id, c.name)"><i class="rp-i rp-i-close" aria-hidden="true"></i></button>
      </li>
    </ul>
    <form v-if="adding" class="rp-libs-form" @submit.prevent="add">
      <label>Tipo
        <select v-model="form.kind" class="rp-input"><option v-for="k in REMOTE_KINDS" :key="k.value" :value="k.value" :title="k.hint">{{ k.label }}</option></select></label>
      <label>Dirección<input v-model.trim="form.url" class="rp-input" :placeholder="form.kind === 'jellyfin' ? 'http://192.168.1.10:8096' : 'https://musica.ejemplo.com'" required /></label>
      <label>Usuario<input v-model.trim="form.username" class="rp-input" autocomplete="username" required /></label>
      <label>Contraseña<input v-model="form.password" class="rp-input" type="password" autocomplete="current-password" required /></label>
      <label>Nombre <small class="rp-muted">(opcional; así se llamará su carpeta)</small><input v-model.trim="form.name" class="rp-input" maxlength="60" /></label>
      <div class="rp-libs-actions">
        <button class="rp-btn rp-primary" :disabled="busy"><span v-if="busy" class="rp-spin"></span> Añadir</button>
        <button type="button" class="rp-btn" :disabled="busy" @click="adding = false">Cancelar</button>
      </div>
      <p v-if="error" class="rp-banner rp-banner-error">{{ error }}</p>
    </form>
    <div v-else class="rp-libs-actions"><button class="rp-btn" @click="adding = true"><i class="rp-i rp-i-add" aria-hidden="true"></i> Añadir biblioteca</button></div>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ask } from '../lib/ask'
import type { RemoteLibraries } from '../lib/libraries'
import { REMOTE_KINDS, type RemoteKind } from '../lib/remote'

/** Ajustes › Bibliotecas: the music servers of the user (Subsonic, Jellyfin) joined to this device's music. */
const props = defineProps<{ libraries: RemoteLibraries }>()
const state = props.libraries.state
const adding = ref(false)
const busy = ref(false)
const error = ref('')
const form = reactive({ kind: 'subsonic' as RemoteKind, url: '', username: '', password: '', name: '' })
const kindLabel = (k: RemoteKind) => REMOTE_KINDS.find((x) => x.value === k)?.label || k
const host = (url: string) => { try { return new URL(url).host } catch (_) { return url } }

async function add() {
  busy.value = true
  error.value = ''
  try {
    if (!/^https?:\/\//i.test(form.url)) form.url = `https://${form.url}`
    await props.libraries.add({ kind: form.kind, url: form.url, username: form.username, name: form.name }, form.password)
    Object.assign(form, { url: '', username: '', password: '', name: '' })
    adding.value = false
  } catch (err: any) { error.value = `No se pudo añadir: ${err?.message || err}` } finally { busy.value = false }
}
async function remove(id: string, name: string) {
  if (!(await ask(`¿Quitar «${name}»? Sus canciones dejan de verse aquí; en el servidor no se toca nada.`, 'Quitar', true))) return
  await props.libraries.remove(id)
}
</script>
