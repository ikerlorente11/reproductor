<template>
  <span v-if="shown.length" ref="root" class="rp-add rp-actmenu">
    <button class="rp-act" :title="label" :aria-label="label" :aria-expanded="open" @click.stop="toggle">
      <i class="rp-i rp-i-more-h" aria-hidden="true"></i>
    </button>
    <!-- a phone: the menu is a sheet from the bottom; touching outside it closes it -->
    <div v-if="open" class="rp-menu-backdrop" @click.stop="close()"></div>
    <div v-if="open" class="rp-menu rp-actmenu-list" role="menu" :aria-label="label" @click.stop>
      <template v-for="(item, i) in shown" :key="i">
        <hr v-if="item === 'sep'" class="rp-menu-sep" />
        <button v-else :class="['rp-menu-item', { 'rp-menu-danger': item.danger }]" :role="item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'"
                :aria-checked="item.checked" :disabled="item.disabled" :title="item.title" @click="run(item)">
          <i :class="['rp-i', item.icon || 'rp-i-chev']" aria-hidden="true"></i>
          <span class="rp-menu-label">{{ item.label }}<small v-if="item.note" class="rp-muted">{{ item.note }}</small></span>
          <span v-if="item.checked !== undefined" :class="['rp-switch', { on: item.checked }]" aria-hidden="true"></span>
        </button>
      </template>
    </div>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

/** One thing the «⋯» menu does: `checked` makes it an on/off option (a switch); `danger` paints it red. */
export interface MenuAction {
  label: string
  icon?: string
  note?: string
  title?: string
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  /** shown (default: yes) */
  if?: boolean
  run: () => void
}

/**
 * The «⋯ Más» of a page's header (a list, an artist, an album): what is used now and then, and what deletes, away from
 * the buttons used all the time (play, shuffle, keep on the device, add to a list). `sep` draws a line between groups;
 * those left empty by `if` are not drawn.
 */
const props = withDefaults(defineProps<{ items: (MenuAction | 'sep')[]; label?: string }>(), { label: 'Más opciones' })

const shown = computed(() => {
  const list = props.items.filter((x) => x === 'sep' || x.if !== false)
  // no line at the start, at the end, or twice in a row
  return list.filter((x, i) => x !== 'sep' || (i > 0 && i < list.length - 1 && list[i - 1] !== 'sep'))
})

const open = ref(false)
const root = ref<HTMLElement>()
function onOutside(e: MouseEvent) { if (!root.value?.contains(e.target as Node)) close() }
function close() { open.value = false; document.removeEventListener('click', onOutside) }
function toggle() {
  if (open.value) { close(); return }
  open.value = true
  document.addEventListener('click', onOutside)
}
function run(item: MenuAction) {
  // an on/off option stays open, to see it change
  if (item.checked === undefined) close()
  item.run()
}
onBeforeUnmount(() => document.removeEventListener('click', onOutside))
</script>
