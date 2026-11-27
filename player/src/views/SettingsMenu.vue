<template>
  <section :class="['rp-page', 'rp-settings', { 'rp-settings-wide': !phone }]">
    <!-- a phone: the list of parts, or the part open (with its way back to the list) -->
    <template v-if="phone">
      <template v-if="!open">
        <header class="rp-page-head"><h1 class="rp-h1">Ajustes</h1></header>
        <nav class="rp-settings-list" aria-label="Ajustes">
          <button v-for="s in sections" :key="s.key" class="rp-settings-row" @click="choose(s.key)">
            <span class="rp-settings-icon"><i :class="['rp-i', s.icon]" aria-hidden="true"></i></span>
            <span class="rp-settings-text"><strong>{{ s.title }}</strong><small v-if="s.note" class="rp-muted rp-ellipsis">{{ s.note }}</small></span>
            <i class="rp-i rp-i-chev rp-muted" aria-hidden="true"></i>
          </button>
        </nav>
      </template>
      <template v-else>
        <!-- the way back is the app's own (its back button, the system's): one step back is the list -->
        <header class="rp-page-head"><h1 class="rp-h1">{{ open.title }}</h1></header>
        <div class="rp-settings-body"><slot :name="open.key" /></div>
      </template>
    </template>

    <!-- a wide screen: the parts on the left, the one open on the right -->
    <template v-else>
      <header class="rp-page-head"><h1 class="rp-h1">Ajustes</h1></header>
      <div class="rp-settings-cols">
        <nav class="rp-settings-list" aria-label="Ajustes">
          <button v-for="s in sections" :key="s.key" :class="['rp-settings-row', { on: shown?.key === s.key }]" :aria-current="shown?.key === s.key"
                  @click="choose(s.key, true)">
            <span class="rp-settings-icon"><i :class="['rp-i', s.icon]" aria-hidden="true"></i></span>
            <span class="rp-settings-text"><strong>{{ s.title }}</strong><small v-if="s.note" class="rp-muted rp-ellipsis">{{ s.note }}</small></span>
          </button>
        </nav>
        <div v-if="shown" class="rp-settings-body">
          <h2 class="rp-settings-title">{{ shown.title }}</h2>
          <slot :name="shown.key" />
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { isPhone as phone } from '../lib/phone'
import { useStore } from '../lib/store'

/** A part of Ajustes: its key (its slot, and in the route), title, icon and a line of how it is now. */
export interface SettingsSection { key: string; title: string; icon: string; note?: string }

/**
 * Ajustes in parts, for each app's settings page (its own parts in slots, one per section's key): on a phone the list of
 * parts, and each part as a page of its own (the system's back button leads back to the list); on a wide screen the
 * list on the left and the part open on the right (the first one, to begin with). The part open is in the route.
 */
const props = defineProps<{ sections: SettingsSection[] }>()
const { view, go } = useStore()

const asked = computed(() => (view.value.v === 'settings' ? view.value.section : undefined))
const open = computed(() => props.sections.find((s) => s.key === asked.value) || null)
const shown = computed(() => open.value || props.sections[0] || null)
/** another part: on a wide screen it takes the place of the one shown (one step back is the previous page, not each part) */
function choose(key: string, replace = false) { go({ v: 'settings', section: key }, replace && !!asked.value) }
</script>
