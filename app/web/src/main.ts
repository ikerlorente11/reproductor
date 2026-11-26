import { createApp } from 'vue'
import App from './App.vue'
import './android.css'
import './lib/theme'

// the system's theme as the app gives it (see android.css)
const setScheme = (scheme: string | null) => { if (scheme === 'dark' || scheme === 'light') document.documentElement.dataset.scheme = scheme }
setScheme(new URLSearchParams(location.search).get('scheme'))
;(window as any).__reproductorScheme = setScheme

createApp(App).mount('#app')
