# El Reproductor

Reproductor de música. Por defecto es un reproductor de la música que tengas en el equipo. Conectado a un servidor
de El Reproductor («Servidor propio») ve toda tu música de la nube, y conectado a soundlift baja música nueva.

- `player/`: el paquete `reproductor-player` (Vue 3, sin compilar: se consume como código fuente). Contiene las
  páginas, el reproductor y el cliente de la API, y lo comparten la web del drive y las apps.
  - Cada plataforma monta `ReproductorShell` con lo que solo ella sabe:
    - la autorización de la API: `Api.bearer` para la sesión web y `Api.basic` con una contraseña de aplicación para las apps;
    - cómo llegar a los archivos de la música (`Files`: listar, borrar, URL para reproducir);
    - dónde está la app (`view` + `navigate`).
  - Pruebas: `cd player && for t in test/*.test.ts; do node --experimental-strip-types $t; done`; tipos: `npx vue-tsc --noEmit -p .`.
- Escritorio (Tauri): en `pc-toolkit/tools/reproductor/app`, publicado con la etiqueta `reproductor-v*`.

Quien consume el paquete lo fija a un commit:
`"reproductor-player": "github:ikerlorente11/reproductor#<commit>&path:player"`.
Para trabajar con el código local, un alias de Vite a `player/src/index.ts`.
