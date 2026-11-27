# Próximas cosas

Escritorio y web suenan con un solo `<audio>` (`htmlOutput` en `player/src/lib/player.ts`); Android, con ExoPlayer
(salida continua: ya recibe las canciones de alrededor). Casi todo lo de sonido va dos veces, una por plataforma. Lo
de la ventana de Windows va en la app de escritorio (`pc-toolkit/tools/reproductor/app`).

En orden: cada bloque se apoya en los anteriores; dentro de cada uno, de lo más pequeño a lo más grande.

## 1. Lo rápido y lo que no depende de nada

- [x] **Precargar la siguiente canción.** Android ya lo hace (ExoPlayer). En escritorio/web, un segundo `<audio>` que
  carga la siguiente 30 s antes de que acabe la actual (`preload` en `htmlOutput`); al llegar, se intercambian. Es la
  base de quitar los silencios y de pasar de una canción a otra sin hueco.
- [x] **Cerrar y minimizar desde el mini reproductor**, en la tarjeta y en la barra (`minimize`/`close` de
  `MiniWindow`).
- [x] **Seguir sonando en segundo plano al cerrar** (Ajustes › Ventana, apagado por defecto): la ventana se esconde en
  la bandeja del sistema y la música sigue; su icono la abre, y su menú pausa, pasa de canción o sale del todo
  (`window.rs` de la app de escritorio).
- [x] **Botones en la vista previa de la barra de tareas** (anterior, reproducir/pausar, siguiente), como Spotify:
  `ITaskbarList3::ThumbBarAddButtons` desde Rust, con la ventana subclasificada para recibir los clics; se vuelven a
  poner con `TaskbarButtonCreated`. Los iconos se dibujan en Rust al tamaño de la pantalla. Pendiente: «Me gusta».
- [x] **Atajos de teclado**: espacio; Ctrl+←/→ canción, Ctrl+↑/↓ volumen, Mayús+←/→ 5 s; en el mini, las flechas
  solas (posición y volumen).
- [x] **Temporizador para dormir**: en X minutos o al acabar la canción, con un fundido de 10 s. En Android lo hace
  ExoPlayer (la página se duerme con la pantalla apagada).
- [x] **Velocidad de reproducción** y **recordar la posición** en canciones de 20 min o más (sesiones, audiolibros,
  podcasts): al volver, sigue donde se dejó.

## 2. El análisis de cada canción

- [x] **Circuito de audio de escritorio/web** (Web Audio, en `htmlOutput`): cada `<audio>` → su ganancia → limitador.
  El ecualizador irá entre medias. CORS comprobado: `media://` del escritorio (equipo y nube) manda `*`; la web del
  drive usa URLs firmadas de su mismo origen; Navidrome manda `*` (también en la petición previa con `Range`). Jellyfin,
  sin servidor con que probar: una fuente que no deje pasa a sonar por un tercer `<audio>` fuera del circuito.
- [x] **Normalizador de volumen** (a −14 LUFS, de −15 a +6 dB) y **quitar los silencios del principio y del final**
  (Ajustes › Sonido, los dos activados). La página mide cada canción la primera vez (`analysis.ts`: BS.1770 a 16 kHz y
  bordes a −50 dBFS) y lo guarda en IndexedDB; mide la actual al empezar y la siguiente mientras tanto.
  - Los silencios no se quitan entre dos canciones seguidas del mismo disco sin aleatorio.
  - Android: ExoPlayer baja con el volumen y sube con `LoudnessEnhancer` sobre su sesión de audio; salta los bordes
    al pasar de canción (no `skipSilence`, que quita también los de en medio).
  - Pendiente, como mejora: medir en el servidor (la nube) o en Rust (el equipo), y leer las etiquetas ReplayGain.

## 3. Ecualizador y salidas (sobre el circuito del bloque 2)

- [x] **Ecualizador** de 10 bandas (`eq.ts`) con 11 preajustes y uno propio (Ajustes › Ecualizador). Escritorio/web:
  filtros de Web Audio entre la ganancia de cada canción y el limitador. Android: el `Equalizer` del sistema sobre la
  sesión de ExoPlayer; cada una de sus bandas (suelen ser 5) toma lo que dicen las 10 a su frecuencia.
- [x] **Volumen extra** (0 a +12 dB, Ajustes › Sonido). Escritorio/web: una ganancia antes del limitador. Android:
  `LoudnessEnhancer`, junto con lo que sube cada canción.
- [x] **Elegir la salida de audio** (Ajustes › Sonido) con `setSinkId`. El sistema solo nombra sus salidas a una página
  con permiso de micrófono: el escritorio se lo da a su página (`on_permission_request`, solo el micrófono), que lo pide
  y lo suelta al momento; la web lo pide con «Ver mis salidas».
- [x] **Ecualizador por salida**: un ajuste para cada salida. Escritorio/web: cada dispositivo elegido. Android:
  altavoz, auriculares con cable o cada aparato Bluetooth (`AudioDeviceCallback`), que cambia solo.
- [x] **Ajustes en apartados** (`SettingsMenu`): en el móvil, una lista y cada apartado en su página; en pantalla
  ancha, la lista a la izquierda. El apartado va en la ruta (`#v=settings&s=eq`).

## 4. Lo independiente, cuando apetezca

- [x] **Radio al acabar la cola** (Ajustes › Reproducción, apagada por defecto; `radio.ts`): cuando quedan dos
  canciones, añade 25 que tienes: de los últimos artistas, de los que Deezer relaciona con ellos (escritorio y Android,
  que pueden preguntarle; la web no), y si son pocas, lo que más escuchas y otros artistas de la biblioteca. Nada de lo
  escuchado hace poco ni de lo que ya está en la cola.
- [x] **Selector de calidad** (Ajustes › Reproducción; en el móvil, otra con datos móviles; `quality.ts`). Solo
  recodifican Navidrome/Subsonic (`maxBitRate`) y Jellyfin (`MaxStreamingBitrate`). La nube (WebDAV) y lo guardado sin
  conexión van siempre en original: el servidor de El Archivador no recodifica.
  - Pendiente, si hace falta: que el servidor recodifique la nube (o la sirva a través de Navidrome, que tiene los
    mismos archivos) para escucharla con datos móviles en calidad baja.

## Hecho además

- [x] **Ajustes compartidos entre dispositivos** (con servidor conectado; `prefs.ts`, y `GET`/`PUT /api/prefs` en El
  Archivador): igualar el volumen, quitar los silencios, el ecualizador general, la radio, la calidad con wifi y la
  velocidad son los mismos en la web, el escritorio y el móvil; gana el último cambio. Son de cada dispositivo: la
  salida y el ecualizador de cada salida, el volumen extra, la calidad con datos móviles, la ventana y el tema.
- [x] **Escuchar sin descargar, desde YouTube Music** (escritorio y Android, sin servidor): cualquier canción, disco,
  lista o artista del catálogo suena al momento, con ▶ y aleatorio en cada página. Se busca por su ISRC (o artista,
  título y duración) en YouTube Music y su audio se pide como el cliente de visionOS de yt-dlp; las canciones que se ven
  se preparan antes (`Files.prepare`). Escritorio: `src-tauri/src/yt.rs`; Android: `Yt.kt`.
- [x] **Seguir no es descargar**: «Seguir» (artistas) y «Guardar» (discos, listas de Deezer) solo lo ponen en tu
  biblioteca, en el dispositivo y, con servidor, igual en todos (`saved.ts`, `GET`/`PUT /api/saved`). «Descargar» (la
  nube) es aparte: baja la música del artista y lo nuevo que saque.
- [x] **Android sin servidor** («de bolsillo», `pocket.ts`): la app responde ella misma a las páginas del catálogo
  (busca en Deezer, artista, disco, listas) y descarga al teléfono: cada canción de YouTube Music en AAC, etiquetada y
  con su portada, en `Música/El Reproductor/<artista>/<disco>/` (`Dl.kt`); los artistas que descargas se mantienen al
  día con las mismas reglas que el servidor (`discography.ts`). Borrar manda a la papelera de Android.

## Pendiente

- [ ] **La web, sin descargar**: escuchar desde YouTube Music en la web a través del servidor (la web no puede pedir
  a YouTube por sí misma).
