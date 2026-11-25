/** Whether the app is on a phone's screen (narrow): then it is laid out as a phone app — the pages as tabs at the
 *  bottom, the player as a bar over them that opens to the whole screen — instead of the sidebar and bottom bar. */
import { ref } from 'vue'

/** The lyrics are open: on a wide screen they take the place of the page, on a phone's player that of the cover. */
export const lyricsOpen = ref(false)

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
