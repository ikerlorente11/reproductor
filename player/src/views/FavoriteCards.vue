<template>
  <section v-if="items.length" class="rp-section">
    <h2 class="rp-h2">Lo que más escuchas</h2>
    <div class="rp-grid rp-favs">
      <article v-for="f in items" :key="f.key" :class="['rp-card', 'rp-card-link', { 'rp-fav-artist': f.kind === 'artist' }]">
        <div :class="['rp-cover', { 'rp-mosaic': !f.picture && f.covers.length >= 4 }]" @click="go(f.view)">
          <img v-if="f.picture" :src="f.picture" alt="" loading="lazy" />
          <template v-else-if="f.covers.length >= 4"><img v-for="c in f.covers.slice(0, 4)" :key="c" :src="c" alt="" loading="lazy" /></template>
          <img v-else-if="f.covers.length" :src="f.covers[0]" alt="" loading="lazy" />
          <span v-else class="rp-cover-none"><i :class="['rp-i', f.icon]" aria-hidden="true"></i></span>
          <button v-if="f.playable" class="rp-cover-play" :title="`Reproducir «${f.name}»`" :disabled="starting === f.key" @click.stop="start(f)">
            <span v-if="starting === f.key" class="rp-spin"></span><i v-else class="rp-i rp-i-play" aria-hidden="true"></i>
          </button>
        </div>
        <div class="rp-card-text" @click="go(f.view)">
          <strong class="rp-ellipsis" :title="f.name">{{ f.name }}</strong>
          <span class="rp-muted rp-small rp-ellipsis">{{ f.note }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { mine, topFavorites, type Favorite } from '../lib/mine'
import { isPhone } from '../lib/phone'
import { playAll } from '../lib/sources'
import { queryFromView, useStore, type LibraryEntry, type View } from '../lib/store'

/**
 * Inicio's «Lo que más escuchas»: the lists and artists listened to most lately (mine.ts counts them), big, with
 * their picture, to open or play at once. What is no longer there (a list deleted) stays out.
 */
const { api, server, device, library, go, notify } = useStore()

interface Card extends Favorite { picture: string | null; note: string; icon: string; playable: boolean }
const viewKey = (v: View) => JSON.stringify(queryFromView(v))

const items = computed<Card[]>(() => {
  if (!library.loaded) return []
  const lists = new Map<string, LibraryEntry>(library.lists.map((e) => [viewKey(e.view), e]))
  const artists = new Map<string, LibraryEntry>(library.artists.map((e) => [viewKey(e.view), e]))
  const out: Card[] = []
  for (const f of topFavorites(mine.favorites)) {
    if (f.kind === 'list') {
      const entry = f.key === 'likes' ? (mine.likes.length ? { name: 'Me gusta', note: `${mine.likes.length} ${mine.likes.length === 1 ? 'canción' : 'canciones'}` } : null)
        : lists.get(viewKey(f.view))
      if (!entry) continue   // deleted (or of a server not connected now)
      const note = (entry.note || '').replace(/ · en este equipo$/, '')
      out.push({ ...f, name: entry.name, picture: null, icon: f.key === 'likes' ? 'rp-i-heart-fill' : 'rp-i-playlist', note: note ? `Lista · ${note}` : 'Lista', playable: true })
    } else {
      if (f.view.v === 'artist' && !server) continue
      if (f.view.v === 'lartist' && !device) continue
      const entry = artists.get(viewKey(f.view))
      out.push({ ...f, name: entry?.name || f.name, picture: entry?.picture || null, icon: 'rp-i-artist', note: 'Artista', playable: f.view.v !== 'search' })
    }
    if (out.length >= (isPhone.value ? 6 : 12)) break
  }
  return out
})

/** Plays it all (shuffled or not, as the player is), counting for it. */
const starting = ref('')
async function start(f: Card) {
  starting.value = f.key
  try {
    if (!(await playAll(f.view, f.name, api, device))) notify(`«${f.name}» no tiene nada que reproducir aquí.`, true)
  } catch (err: any) {
    notify(err?.message || String(err), true)
  } finally { starting.value = '' }
}
</script>
