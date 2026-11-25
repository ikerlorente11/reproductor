/** A question with Yes/No inside the app (never the browser's or the system's window): `await ask('¿Borrar…?', 'Borrar')`.
 *  The Shell shows it — a sheet from the bottom on a phone, a dialog over the page on a wide screen. */
import { reactive } from 'vue'

export const question = reactive({
  text: '',
  ok: 'Aceptar',
  danger: false,
  resolve: null as ((yes: boolean) => void) | null
})

export function ask(text: string, ok = 'Aceptar', danger = false): Promise<boolean> {
  question.resolve?.(false)   // one at a time: an earlier one is answered «no»
  return new Promise((resolve) => Object.assign(question, { text, ok, danger, resolve }))
}

export function answer(yes: boolean) {
  const r = question.resolve
  Object.assign(question, { text: '', resolve: null })
  r?.(yes)
}
