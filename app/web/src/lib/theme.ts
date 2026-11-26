/** The app's theme: the system's (as the app says it, see main.ts and android.css) or one chosen in Ajustes. Kept in this
 * page's storage; the colours are android.css's (`data-theme` on <html> when one is chosen), and the app (React Native)
 * is told the one chosen (null: the system's), for the status bar's icons and the background behind the page. */
import { ref, watch } from 'vue'
import { tellApp } from './host'

export type Theme = 'system' | 'light' | 'dark'
const KEY = 'reproductor.theme'

function read(): Theme {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system' } catch (_) { return 'system' }
}
export const theme = ref<Theme>(read())

function apply() {
  if (theme.value === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme.value
  tellApp({ type: 'theme', scheme: theme.value === 'system' ? null : theme.value })
}
watch(theme, (t) => {
  try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t) } catch (_) {}
  apply()
})
apply()
