/**
 * The quality the music servers send their songs at (Ajustes › Reproducción): the original, or recoded to a lower bit
 * rate, with its own setting for mobile data (a phone). Only those that can recode do: Navidrome and the other Subsonic
 * servers (`maxBitRate`), Jellyfin (`MaxStreamingBitrate`). One's cloud (WebDAV) and what is kept on the device are the
 * original files: El Archivador's server does not recode.
 */
import { reactive, watch } from 'vue'

export type Quality = 'original' | 'high' | 'normal' | 'low'
export const QUALITIES: { key: Quality; name: string; kbps: number; note: string }[] = [
  { key: 'original', name: 'Original', kbps: 0, note: 'El archivo tal cual' },
  { key: 'high', name: 'Alta', kbps: 320, note: '320 kbps' },
  { key: 'normal', name: 'Normal', kbps: 160, note: '160 kbps' },
  { key: 'low', name: 'Baja', kbps: 96, note: '96 kbps' }
]

const KEY = 'reproductor.quality'
export const quality = reactive({ wifi: 'original' as Quality, mobile: 'normal' as Quality })
try { Object.assign(quality, JSON.parse(localStorage.getItem(KEY) || '{}')) } catch (_) {}
watch(quality, () => { try { localStorage.setItem(KEY, JSON.stringify(quality)) } catch (_) {} })

/** On mobile data now (as the system tells the page; a computer: never). */
export function onMobileData(): boolean {
  const c = (typeof navigator !== 'undefined' && (navigator as any).connection) || null
  return !!c && c.type === 'cellular'
}
/** The bit rate a server should send at now (kbps; 0: the original). */
export function maxKbps(): number {
  const q = onMobileData() ? quality.mobile : quality.wifi
  return QUALITIES.find((x) => x.key === q)?.kbps || 0
}
