import { NativeModule, requireOptionalNativeModule } from 'expo'

import type { HostStarted } from './ReproductorHost.types'

declare class ReproductorHostModule extends NativeModule<{}> {
  /** starts the local server the web view loads the page from (or finds it running) */
  start(): Promise<HostStarted>
  /** serves the page the JS bundle brings (a zip: an update brings a new one) instead of the APK's; its folder or null */
  useWeb(uri: string, hash: string): Promise<string | null>
  /** the permission to read the music was just given: the library reads it */
  rescan(): void
}

/** null in Expo Go (no native code there). */
export default requireOptionalNativeModule<ReproductorHostModule>('ReproductorHost')
