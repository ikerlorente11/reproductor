# Próximas cosas

Escritorio y web suenan con un solo `<audio>` (`htmlOutput` en `player/src/lib/player.ts`); Android, con ExoPlayer
(salida continua: ya recibe las canciones de alrededor). Casi todo lo de sonido va dos veces, una por plataforma. Lo
de la ventana de Windows va en la app de escritorio (`pc-toolkit/tools/reproductor/app`).

En orden: cada bloque se apoya en los anteriores; dentro de cada uno, de lo más pequeño a lo más grande.

## 1. Lo rápido y lo que no depende de nada

- [ ] **Precargar la siguiente canción.** Android ya lo hace (ExoPlayer). En escritorio/web, un segundo `<audio>` que
  cargue la siguiente unos segundos antes de que acabe la actual. Es la base de quitar los silencios y de pasar de una
  canción a otra sin hueco.
- [ ] **Cerrar y minimizar desde el mini reproductor**, en la tarjeta y en la barra. Ahora hay que volver a la ventana
  completa para cerrar la app.
- [ ] **Seguir sonando en segundo plano al cerrar** (opcional, en Ajustes): al cerrar la ventana, la app se queda en
  la bandeja del sistema y la música sigue; desde su icono se vuelve a abrir, se pausa o se sale del todo. Ahora no hay
  bandeja ni se intercepta el cierre.
- [ ] **Botones en la vista previa de la barra de tareas** (anterior, reproducir/pausar, siguiente), como Spotify:
  `ITaskbarList3::ThumbBarAddButtons` desde Rust, con la ventana subclasificada para recibir los clics. El botón
  central cambia entre ▶ y ⏸ según suene; se vuelven a poner si el Explorador se reinicia (`TaskbarButtonCreated`).
  Iconos `.ico` blancos sacados de los de la app. Quizá un cuarto botón de «Me gusta».
- [ ] **Atajos de teclado en el mini reproductor**: espacio para pausar, flechas para el volumen y la posición.
- [ ] **Temporizador para dormir**: parar en X minutos o al acabar la canción, con un fundido al final.
- [ ] **Velocidad de reproducción** y **recordar la posición** en canciones largas (sesiones, audiolibros, podcasts):
  al volver, sigue donde se dejó.

## 2. El análisis de cada canción

- [ ] **Circuito de audio de escritorio/web** (Web Audio): normalizar → ecualizar → subir → limitar, montado una vez.
  Lo primero, comprobar que las URLs de cada fuente (equipo, nube, Navidrome, Jellyfin) tienen CORS: sin él, Web Audio
  las deja en silencio, y eso cambiaría el plan de todo el sonido.
- [ ] **Normalizador de volumen** y **quitar los silencios del principio y del final**, juntos. Los dos activados por
  defecto y se quitan en Ajustes. Comparten lo más costoso: analizar cada canción una vez y guardarlo (la sonoridad, en
  LUFS / ReplayGain, y dónde empieza y acaba el sonido); la nube, en el servidor; el equipo, en la app la primera vez
  que suena; si el archivo trae etiquetas ReplayGain, esas.
  - Los silencios no se quitan entre dos canciones seguidas del mismo disco en orden (discos que encadenan canciones).
  - Android: un procesador de audio de ExoPlayer para el volumen; para los silencios no vale su `skipSilence`, que
    quita también los de en medio: recortar solo los bordes.

## 3. Ecualizador y salidas (sobre el circuito del bloque 2)

- [ ] **Ecualizador** de 10 bandas con preajustes y uno propio. Escritorio/web: filtros de Web Audio. Android:
  `Equalizer` sobre la sesión de audio de ExoPlayer.
- [ ] **Subir el volumen por encima del máximo**, con limitador para que no distorsione. Escritorio/web:
  `DynamicsCompressor`. Android: `LoudnessEnhancer`.
- [ ] **Elegir la salida de audio** en escritorio (altavoces, cascos, HDMI…) sin tocar Windows (`setSinkId`).
- [ ] **Ecualizador por salida**: un ajuste para cada salida, que cambia solo al cambiar de salida.

## 4. Lo independiente, cuando apetezca

- [ ] **Radio al acabar la cola** (opcional, en Ajustes): seguir con canciones parecidas (del mismo artista y de los
  relacionados de Deezer) en vez de quedarse en silencio.
- [ ] **Selector de calidad** de la nube y de lo guardado sin conexión (original, alta, normal, baja; quizá otra con
  datos móviles). Mirar antes si el servidor transcodifica; Navidrome con `maxBitRate`, Jellyfin ya pide formato.
