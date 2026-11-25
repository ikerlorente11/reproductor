import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Appearance, BackHandler, Linking, PermissionsAndroid, Platform, StatusBar as RNStatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import * as SystemUI from 'expo-system-ui'
import { Asset } from 'expo-asset'

import ReproductorHost from './modules/reproductor-host'

/**
 * El Reproductor for Android: the shared pages (reproductor-player, built into the native module's assets) shown in a
 * web view, served by the app's own local server (modules/reproductor-host). This side only starts that server, asks
 * for the permission to read the music, shows the page, handles the back button and hands the page the songs other
 * apps open with El Reproductor. The sound itself is native (Media3, in the host): it goes on with the screen off.
 */
SplashScreen.preventAutoHideAsync().catch(() => {})

const DARK = '#141417'
const LIGHT = '#fafafc'

// In development the page's console and errors come out here (Metro): the web view does not log them itself.
const DEV_CONSOLE = __DEV__ ? `(function () {
  var rn = window.ReactNativeWebView;
  function send(level, args) {
    try { rn.postMessage(JSON.stringify({ type: 'log', level: level, args: Array.prototype.map.call(args, function (x) {
      if (typeof x === 'string') return x;
      if (x && x.stack) return String(x.stack);
      try { return JSON.stringify(x); } catch (e) { return String(x); }
    }) })); } catch (e) {}
  }
  window.addEventListener('error', function (e) { send('error', [e.message + ' @ ' + e.filename + ':' + e.lineno]); });
  window.addEventListener('unhandledrejection', function (e) { send('error', ['unhandled: ' + (e.reason && e.reason.stack || e.reason)]); });
  ['log', 'info', 'warn', 'error'].forEach(function (k) { var o = console[k]; console[k] = function () { send(k, arguments); o.apply(console, arguments); }; });
})(); true;` : undefined

/** The page this JavaScript brings (scripts/zip-web.mjs): an EAS Update carries a new one, which the host then serves
 * instead of the APK's. Out of development only (there the page comes from Vite); when anything fails the APK's goes on. */
async function adoptBundledPage(): Promise<void> {
  if (__DEV__ || !ReproductorHost?.useWeb) return
  try {
    const asset = Asset.fromModule(require('./assets/web.zip'))
    await asset.downloadAsync()
    if (asset.localUri) await ReproductorHost.useWeb(asset.localUri, asset.hash || '')
  } catch (err) {
    console.warn('página del APK:', err)
  }
}

/** The permission to read this device's music (asked once; the page says what to do if it was refused). */
async function askForMusic(): Promise<void> {
  if (Platform.OS !== 'android') return
  const permission = Number(Platform.Version) >= 33 ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
  try {
    if (await PermissionsAndroid.check(permission)) return
    const got = await PermissionsAndroid.request(permission)
    if (got === PermissionsAndroid.RESULTS.GRANTED) ReproductorHost?.rescan()
  } catch (_) { /* the library says it has no permission */ }
}

export default function App() {
  const system = useColorScheme()
  const [page, setPage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** the colour the page wants behind the status bar (the player's, while it covers the screen), or null */
  const [top, setTop] = useState<string | null>(null)
  const web = useRef<React.ComponentRef<typeof WebView> | null>(null)
  const canGoBack = useRef(false)
  const pending = useRef<string[]>([])
  const ready = useRef(false)

  useEffect(() => {
    if (!ReproductorHost) {
      setError('Esta app necesita su módulo nativo: no funciona en Expo Go (usa la development build).')
      SplashScreen.hideAsync().catch(() => {})
      return
    }
    adoptBundledPage()
      .then(() => ReproductorHost!.start())
      .then(({ url, token }) => {
        // in development the page can come from Vite on the PC (EXPO_PUBLIC_WEB_URL); the host stays where it is
        const dev = __DEV__ && process.env.EXPO_PUBLIC_WEB_URL
        const scheme = `&scheme=${Appearance.getColorScheme() || 'light'}`
        setPage(dev ? `${dev.replace(/\/+$/, '')}/?t=${token}&host=${encodeURIComponent(url.replace(/\/+$/, ''))}${scheme}` : `${url}?t=${token}${scheme}`)
      })
      .catch((err) => setError(String(err?.message || err)))
      .finally(() => { SplashScreen.hideAsync().catch(() => {}); askForMusic() })
  }, [])

  const scheme = system === 'dark' ? 'dark' : 'light'
  useEffect(() => { try { Promise.resolve(SystemUI.setBackgroundColorAsync(scheme === 'dark' ? DARK : LIGHT)).catch(() => {}) } catch (_) {} }, [scheme])

  // the back button goes back in the page (its views live in the hash); on the first view it leaves the app (the music goes on)
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) { web.current?.goBack(); return true }
      return false
    })
    return () => sub.remove()
  }, [])

  // a song opened with El Reproductor from another app («Abrir con»)
  const open = useCallback((uri: string | null) => {
    if (!uri || !uri.startsWith('content://') && !uri.startsWith('file://')) return
    if (ready.current) web.current?.injectJavaScript(`window.__reproductorOpen && window.__reproductorOpen(${JSON.stringify(uri)}); true;`)
    else pending.current.push(uri)
  }, [])
  useEffect(() => {
    Linking.getInitialURL().then((u) => open(u ?? null))
    const sub = Linking.addEventListener('url', (e) => open(e.url))
    return () => sub.remove()
  }, [open])

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let msg: any
    try { msg = JSON.parse(e.nativeEvent.data) } catch (_) { return }
    if (msg.type === 'log') {
      ;(msg.level === 'error' ? console.error : msg.level === 'warn' ? console.warn : console.log)('[web]', ...(msg.args || []))
    } else if (msg.type === 'ready') {
      ready.current = true
      for (const uri of pending.current.splice(0)) open(uri)
    } else if (msg.type === 'open-url' && typeof msg.url === 'string') {
      Linking.openURL(msg.url).catch(() => {})
    } else if (msg.type === 'permission') {
      askForMusic()
    } else if (msg.type === 'top') {
      setTop(typeof msg.color === 'string' ? msg.color : null)
    }
  }, [open])

  const background = scheme === 'dark' ? DARK : LIGHT
  return (
    <View style={[styles.root, { backgroundColor: background, paddingTop: RNStatusBar.currentHeight || 0 }]}>
      <StatusBar style={top || scheme === 'dark' ? 'light' : 'dark'} />
      {top ? <View style={[styles.top, { height: RNStatusBar.currentHeight || 0, backgroundColor: top }]} /> : null}
      {error ? (
        <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
      ) : !page ? (
        <View style={styles.center}><ActivityIndicator color="#1fb866" /></View>
      ) : (
        <WebView
          ref={web}
          source={{ uri: page }}
          style={[styles.web, { backgroundColor: background }]}
          originWhitelist={['http://127.0.0.1:*', 'http://localhost:*', 'blob:*', 'about:*', 'data:*']}
          domStorageEnabled
          javaScriptEnabled
          allowsBackForwardNavigationGestures={false}
          setSupportMultipleWindows={false}
          mediaPlaybackRequiresUserAction={false}
          overScrollMode="never"
          textZoom={100}
          forceDarkOn={false}
          onMessage={onMessage}
          injectedJavaScriptBeforeContentLoaded={DEV_CONSOLE}
          onError={(e: { nativeEvent: { description?: string; url?: string } }) => console.warn('[web] no carga', e.nativeEvent.description, e.nativeEvent.url)}
          onNavigationStateChange={(s: { canGoBack: boolean }) => { canGoBack.current = s.canGoBack }}
          onShouldStartLoadWithRequest={(req: { url: string }) => {
            if (req.url.startsWith('http://127.0.0.1') || req.url.startsWith('http://localhost')) return true
            if (/^(blob|about|data):/.test(req.url)) return true
            Linking.openURL(req.url).catch(() => {})   // links out (a song on YouTube, an artist's page) go to the browser
            return false
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  web: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#1fb866', textAlign: 'center', fontSize: 15 },
})
