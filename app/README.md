# El Reproductor para Android

La app Android (Expo) enseña las páginas compartidas (`../player`, el paquete `reproductor-player`) en un WebView. Lo que el
WebView no puede hacer lo hace un **host nativo** (`modules/reproductor-host`, módulo Expo en Kotlin): un servidor HTTP en
`127.0.0.1:48143` que sirve la página y hace lo mismo que la parte en Rust del escritorio. Todo lo que no sea la propia
página exige el token que la app pasa al cargarla (`?t=`).

- `App.tsx`: arranca el host, pide el permiso de la música, muestra el WebView, el botón atrás y «Abrir con».
- `web/`: la página (Vue + Vite).
  - `src/App.vue` monta `ReproductorShell` con la música del móvil y, si hay uno conectado, el servidor.
  - `src/lib/host.ts` habla con el host.
  - `src/lib/server.ts` conecta «Servidor propio» con la contraseña de siempre: la app se crea una de aplicación y
    solo guarda esa.
  - `npm run web:build` la deja en `modules/reproductor-host/android/src/main/assets/web/` (no va a git) y la empaqueta en
    `assets/web.zip`, para que un EAS Update lleve también la página.
- El host (`modules/reproductor-host/android/.../`):
  - `HostServer.kt`: las rutas.
  - `Library.kt`: la música del móvil desde el índice de Android (MediaStore). Las portadas se sacan una vez y el índice
    se guarda entre arranques. Los ids son un hash de la ruta, como en el escritorio.
  - `Cloud.kt`: la nube del servidor por WebDAV. `/w/<ruta>` se sirve por rangos, y las copias sin conexión van a
    `Android/data/<app>/files/Music/El Reproductor`.
  - `Playback.kt` y `PlaybackService.kt`: el sonido con Media3 (ExoPlayer y MediaSessionService). Sigue con la
    pantalla apagada y sale en la notificación, la pantalla de bloqueo y los botones de los auriculares.
    - La página le pasa una ventana de su cola (`setOutput(nativeOutput)` en `player.ts`). El nativo avanza solo y avisa
      a la página de la canción en la que está.
  - `Settings.kt`: los ajustes y los secretos de la página. Los secretos van cifrados con el keystore.

## Desarrollo

Expo Go no sirve: la app necesita su módulo nativo. Se usa una **development build** («El Reproductor_dev»,
`com.ikerlorente11.reproductor.dev`), que convive con la normal.

1. Compilar desde una ruta corta, porque CMake se ahoga con rutas largas en Windows:

   ```
   robocopy <repo> C:\rep /E /MT:16 /XD .git
   cd C:\rep\app
   npm --prefix web run build && node scripts/zip-web.mjs
   APP_VARIANT=development npx expo prebuild --platform android --clean --no-install
   echo reactNativeArchitectures=arm64-v8a >> android/gradle.properties
   cd android && ./gradlew assembleDebug        # con JAVA_HOME del JDK 17, desde bash
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

2. El día a día, sin recompilar:

   ```
   adb reverse tcp:8083 tcp:8083 && adb reverse tcp:5173 tcp:5173
   npm --prefix web run dev                                       # Vite: la página con recarga en caliente
   APP_VARIANT=development npx expo start --dev-client --port 8083 --localhost
   ```

   - Con `EXPO_PUBLIC_WEB_URL=http://localhost:5173` (en `.env.development.local`), la página sale de Vite y habla con
     el host del móvil.
   - Sin esa variable, se usa la página compilada en la APK.
   - Solo el Kotlin necesita `assembleDebug` otra vez.

## Lo que falta

- **Motor de descargas sin servidor** (soundlift y el servicio, como en el escritorio). Se decidirá al final, junto con
  la publicación en Play Store: Google no admite apps que bajan de YouTube.
- EAS (`eas init`), la ficha de Play y la publicación.
