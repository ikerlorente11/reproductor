/**
 * reproductor-player: El Reproductor's pages and player, shared by the cloud's web app and the apps.
 * Each platform mounts `ReproductorShell` with what only it knows: the API's authorization, how to
 * reach the music's files (`Files`) and where the app is (`view` + `navigate`).
 */
export { default as ReproductorShell } from './views/Shell.vue'
export * from './lib/api.ts'
export * from './lib/library.ts'
export * from './lib/player.ts'
export * from './lib/soundlift.ts'
export * from './lib/store.ts'
export * from './lib/device.ts'
export * from './lib/mine.ts'
export * from './lib/lyrics.ts'
