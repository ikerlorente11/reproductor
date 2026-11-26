# Próximas cosas

Escritorio y web suenan con un solo `<audio>` (`htmlOutput` en `player/src/lib/player.ts`); Android, con ExoPlayer
(salida continua: ya recibe las canciones de alrededor). Casi todo lo de sonido va dos veces, una por plataforma.

## Sonido

- [ ] **Precargar la siguiente canción.** Android ya lo hace (ExoPlayer). En escritorio/web, un segundo `<audio>` que
  cargue la siguiente unos segundos antes de que acabe la actual. Va primero: lo demás se apoya en ella.
- [ ] **Circuito de audio de escritorio/web** (Web Audio): normalizar → ecualizar → subir → limitar, montado una vez.
  Comprobar al empezar que las URLs de cada fuente (equipo, nube, Navidrome, Jellyfin) tienen CORS; sin él, Web Audio
  las deja en silencio.
- [ ] **Normalizador de volumen.** Activado por defecto; se quita en Ajustes. La sonoridad de cada canción (LUFS /
  ReplayGain) se mide una vez y se guarda: la nube, en el servidor; el equipo, en la app la primera vez que suena; si el
  archivo trae etiquetas ReplayGain, esas. Android: un procesador de audio de ExoPlayer.
- [ ] **Quitar los silencios del principio y del final.** Activado por defecto; se quita en Ajustes. Se detectan una
  vez, como la sonoridad. No se quitan entre dos canciones seguidas del mismo disco en orden (discos que encadenan las
  canciones). En Android no vale `skipSilence` de ExoPlayer: quita también los de en medio.
- [ ] **Selector de calidad** de la nube y de lo guardado sin conexión (original, alta, normal, baja; quizá otra con
  datos móviles). Mirar antes si el servidor transcodifica; Navidrome con `maxBitRate`, Jellyfin ya pide formato.
- [ ] **Ecualizador** de 10 bandas con preajustes y uno propio. Escritorio/web: filtros de Web Audio. Android:
  `Equalizer` sobre la sesión de audio de ExoPlayer.
- [ ] **Subir el volumen por encima del máximo**, con limitador para que no distorsione. Escritorio/web:
  `DynamicsCompressor`. Android: `LoudnessEnhancer`.
- [ ] **Elegir la salida de audio** en escritorio (altavoces, cascos, HDMI…) sin tocar Windows (`setSinkId`).
- [ ] **Ecualizador por salida**: un ajuste para cada salida, que cambia solo al cambiar de salida.

## Reproducción

- [ ] **Temporizador para dormir**: parar en X minutos o al acabar la canción, con un fundido al final.
- [ ] **Radio al acabar la cola** (opcional, en Ajustes): seguir con canciones parecidas (del mismo artista y de los
  relacionados de Deezer) en vez de quedarse en silencio.
- [ ] **Recordar la posición** en canciones largas (sesiones, audiolibros, podcasts): al volver, sigue donde se dejó.
- [ ] **Velocidad de reproducción.**
- [ ] **Atajos de teclado en el mini reproductor**: espacio para pausar, flechas para el volumen y la posición.
