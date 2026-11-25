import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import vue from '@vitejs/plugin-vue'

// The shared player, from the repo itself (../../player/src), as source: watched and hot-reloaded like our own files.
const player = fileURLToPath(new URL('../../player/src', import.meta.url))

// The built page goes into the host module's assets: the app's local server serves it from there
// (modules/reproductor-host, HostServer.kt). Relative paths, as it is served at http://127.0.0.1:<port>/.
export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: [{ find: 'reproductor-player/ui.css', replacement: `${player}/lib/ui.css` }, { find: 'reproductor-player', replacement: `${player}/index.ts` }],
    // the player's own imports (vue) come from this project's node_modules
    dedupe: ['vue']
  },
  clearScreen: false,
  // in development the phone reaches this server through `adb reverse tcp:5173 tcp:5173`
  server: { host: '127.0.0.1', port: 5173, strictPort: true, fs: { allow: [searchForWorkspaceRoot(process.cwd()), player] } },
  build: {
    outDir: '../modules/reproductor-host/android/src/main/assets/web',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false
  }
})
