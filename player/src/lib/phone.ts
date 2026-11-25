/** Whether the app is on a phone's screen (narrow): then it is laid out as a phone app — the pages as tabs at the
 *  bottom, the player as a bar over them that opens to the whole screen — instead of the sidebar and bottom bar. */
import { ref } from 'vue'

/** The player's panel open — the lyrics, the queue or the devices: on a wide screen it takes the page's place, in a
 *  phone's player the cover's. Never a window of its own. */
export type Panel = '' | 'lyrics' | 'queue' | 'devices'
export const panel = ref<Panel>('')
export function togglePanel(name: Panel) { panel.value = panel.value === name ? '' : name }

const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 760px)') : null
export const isPhone = ref(!!query?.matches)
query?.addEventListener?.('change', (e) => { isPhone.value = e.matches })

/** A song's row on a phone: its actions (add to a list, delete…) stay behind «⋯», which shows them in the row. */
export function toggleRow(e: Event) {
  const row = (e.currentTarget as HTMLElement | null)?.closest('li')
  if (!row) return
  const open = !row.classList.contains('rp-open')
  row.parentElement?.querySelectorAll(':scope > li.rp-open').forEach((li) => li.classList.remove('rp-open'))
  row.classList.toggle('rp-open', open)
}
