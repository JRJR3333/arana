# Instrucciones para Claude: cómo actualizar Araña

Araña es la app personal de Juan para iPhone. Desde el 2026-10-20 el objetivo es que sea **una app nativa propia** (`nativo/ios/`, ver `OBJETIVO.md`). La web de GitHub Pages (`index.html`, rama `master`) es también la pantalla de la app de Android. Este archivo explica cómo atender sus peticiones de nuevas habilidades.

## Una sola pantalla, tres plataformas (desde la 0.22.0)

- **El aspecto manda la app de iPhone** (`nativo/ios/Arana/ContentView.swift`): fondo de rejilla, telaraña que crece (`arana.hilos`), bocadillo, la araña de puntos y líneas en el centro, y abajo micro, campo «Dígame qué hacer» e «Ir». `index.html` la copia con los mismos números (`ANG`, `REST`, `L1`, `L2` en `draw`; `drawTela`). Si cambia algo visible en `ContentView.swift`, se cambia igual en `index.html`, y al revés.
- **Todo lo demás vive en Ajustes** (la rueda): cerebro, lo que sabe de Juan, Evolución, Valorar mejoras, lo aprendido, el bolsillo, permisos y memoria. No se vuelve a poner una pantalla de iconos.
- **La araña camina por toda la pantalla (desde la 0.23.0, lo pidió Juan).** Su sitio es el nido del centro (`#nest`), pero pasea, curiosea, lanza la red, baila, sigue el dedo y se esconde en el borde. En la web es un lienzo a pantalla completa (`#cv`, motor `update`/`draw`) con `#hit` para tocarla; en la app de iPhone, `off`/`heading`/`walking` en `ContentView.swift`. No se vuelve a quitar. Toques: uno escucha, dos salta, tres baila, mantener pulsada abre su menú, arrastrar la mueve.
- **Lo que no se puede perder** (Juan lo reclamó cuando la 0.22 lo quitó): caminar, bailar, que haga preguntas (`askQuestion` / `preguntarAlgo`), y que lo que no sabe se lo pida a Claude (`offerClaude` / `Peticiones.swift`; con token de GitHub lo crea sola). Antes de quitar o «limpiar» algo visible, preguntar a Juan.
- **Teclado:** la web ajusta `#app` y `#sheet` a `visualViewport` (`fitViewport`, clase `kb`) y la app de iPhone encoge araña y bocadillo con el campo enfocado. Cualquier cambio de la pantalla se prueba también con el teclado abierto.
- **Lo que cambia es lo que puede hacer cada una**, según lo que permite el aparato:
  - `CAPS` en `index.html` dice qué pasos hay en `android` (la app de Android: la que más hace), `ios` (la web en el iPhone) y `web` (un ordenador). *Ajustes → Lo que puedo hacer en…* sale de `CAP_LIST`.
  - El cerebro solo recibe los pasos de su plataforma (`STEP_TYPES`).
  - El paso `spider` (moverse: `MOVES` en la web, `Movimiento` en Swift) está en todas las plataformas.
  - La app de Android hace sus órdenes con `AranaAndroid.orden(id, 'arana://…')` y contesta en `window.__aranaRes`. `BRIDGE2` distingue la app 0.22.0 de la anterior.
- **Prioridad:** lo nuevo va primero a Android si Android lo permite. Juan pidió que Android tenga más que nadie.

## Peticiones

- Llegan como *issues* con la etiqueta `nueva-habilidad`. Las crea la propia app cuando no sabe hacer algo.
- El cuerpo trae:
  - la frase que dijo Juan,
  - lo que respondió la araña,
  - cuántas veces lo ha pedido,
  - versión, nivel y dispositivo.

## Cómo resolver una petición

1. **Decidir si iOS lo permite.** Una web app en iPhone solo puede:
   - abrir apps con su enlace (URL scheme),
   - lanzar el atajo `Araña` con `shortcuts://run-shortcut?name=Araña&input=text&text=accion|valor`,
   - copiar al portapapeles dentro de un toque,
   - abrir enlaces (`whatsapp://send?text=`, `sms:`, `tel:`, `maps://?q=`…),
   - usar lo que haya en su propio almacenamiento.

   No puede tocar dentro de otras apps, leer su contenido, mover iconos, ni hacer nada en segundo plano.
2. **Si no es posible**, comentar en el issue en español, en dos o tres frases, por qué no y qué alternativa hay. Etiquetar con `no-posible` y cerrar.
3. **Si es posible**, implementarlo:
   - **Todo en `index.html`.** Sin compilación ni dependencias nuevas, y sin claves ni secretos.
   - **Una app nueva** se añade a `CAT_SRC` (`id|nombre|URL scheme|color|otras palabras`). En Android no hace falta el enlace: `Apps.kt` la busca por su nombre o por su paquete.
   - **Un ajuste nuevo** se añade a `SETS` con su `sc`, y en Android a `Ajustes.kt`. En el comentario del issue se explica qué bloque añadir al atajo «Araña» en la app Atajos (iPhone), con los nombres de las acciones en español.
   - **Una orden nueva** se añade en `rules()`. Hay que quitarla de `CANT` si estaba allí.
   - **Mantener la personalidad:** mayordomo serio, trata de usted, frases cortas.
   - **No romper nada de lo que ya existe:**
     - el aprendizaje (`mem`, `stats`, `log`, `wishes`),
     - las claves de `localStorage` (prefijo `arana.`),
     - la araña.
4. **Publicar la versión:**
   - Subir la versión en `version.json` (semver) y poner como primera nota, en primera persona de la araña, lo que ha aprendido. Ejemplo: «Ya sé abrir Spotify.»
   - Subir `const V` en `sw.js` (por ejemplo, `arana-v4`).
5. **Comprobar:** extraer el `<script>` de `index.html` y pasarle `node --check`. Si hay reglas nuevas, probarlas con `window.__arana.rules('frase')` en jsdom.
6. **Entregar:**
   - Hacer commit en `master` con un mensaje en español que empiece por `Habilidad:` o `No posible:`.
   - Comentar en el issue qué ha cambiado y qué tiene que hacer Juan, si hace falta (por ejemplo, añadir un bloque al atajo).
   - Cerrar el issue.

## Límites

- Un commit por versión basta; el mensaje nombra los issues que resuelve.
- Si una petición es ambigua, comentar con una pregunta concreta y dejarla abierta con la etiqueta `necesita-info`.
- Nunca borrar datos del usuario ni cambiar el nombre del atajo `Araña`.

## El cerebro

Desde la 0.5.0 la araña piensa con la API de Claude (`claude-haiku-5-5`). La clave la guarda Juan en su iPhone; nunca va en el repo. Funciona así:

- `brainSystem()` describe las herramientas y el contexto que se envían en cada consulta.
- `PLAN_TOOL` define el plan que devuelve el modelo.
- `toActs()` traduce ese plan a acciones.
- `planFlow()` ejecuta el plan.

Al añadir una habilidad nueva:

- **Apps y ajustes:** lo que se añade a `CAT_SRC` o a `SETS` le llega al cerebro sin más.
- **Un tipo de paso nuevo:**
  - su capacidad en `CAPS` (y una línea en `CAP_LIST`),
  - su descripción en `STEP_DOCS` (el `enum` de `PLAN_TOOL` sale de ahí),
  - `toActs()`, `urlFor()` y `label()`,
  - si es de Android, su orden en `ejecutar()` de `MainActivity.kt`.
- **Las reglas** (`rules()`) siguen siendo el plan B, para cuando no hay conexión ni clave.
- **Gastar poco** es un requisito de diseño:
  - lo que se pueda resolver en local (reglas, `mem`, `planCache`) no debe llamar a la API;
  - no se sube `max_tokens` ni se añade contexto a `brainSystem()` sin necesidad;
  - se respeta el tope diario (`capReached()`).

## Iconos

- Desde la 0.22.0 la pantalla ya no dibuja iconos de apps. No se suben imágenes de iconos al repo.
- Excepción (0.30.0, lo pidió Juan): el botón del caballo junto a la rueda (`#chessBtn` en la web, `checkerboard.rectangle` en `ContentView.swift`) abre la sala de ajedrez. Es un acceso, no una pantalla de iconos.

## App nativa (`nativo/ios/`)

- SwiftUI, iOS 17+, proyecto generado con XcodeGen (`project.yml`). No se sube el `.xcodeproj`.
- Se compila en GitHub Actions (`.github/workflows/ios.yml`, macOS). Es la única compilación permitida: en la nube, nunca en el iPhone de Juan.
- Desde el 2026-10-21 Juan tiene Mac: instala con Xcode y su Apple ID siguiendo `nativo/ios/INSTALAR.md` (script `nativo/ios/instalar.sh`). El proyecto debe seguir sin capacidades que exijan cuenta de pago (App Groups, push, iCloud…), para que funcione con el *Personal Team* gratuito.
- Antes de dar algo por hecho, comprobar que el workflow del último commit está en verde (`gh api repos/JRJR3333/arana/actions/runs?per_page=1`). Si está rojo, leer el log del job y arreglarlo en esa misma ejecución.
- Funciones nuevas: dentro del código de la app (EventKit, App Intents, AVFoundation, WidgetKit, ActivityKit…), no en Atajos.
- Gastar poco con Claude, igual que en la web: `max_tokens` corto, sin historial largo.
- La araña tiene también una app de Android (`nativo/android/`, Kotlin sin librerías, workflow «App Android»): la web dentro de un WebView más órdenes nativas `arana://` (`MainActivity.kt` y `Ajustes.kt`). El APK se publica en la versión `android` del repo. Las peticiones de Android (el hermano de Juan) se atienden igual.
- La app de Android carga la web publicada, así que la web nueva tiene que seguir funcionando con un APK antiguo: sin `AranaAndroid.orden`, solo se usan los enlaces `arana://` de siempre.
- Firma: cuando Juan tenga cuenta de desarrollador, sus certificados van en *GitHub Secrets*, nunca en el repo.

## Modo evolución (una vez al día)

Una tarea programada ejecuta a Claude una vez al día, a las 9:33 (hora de Madrid), use Juan la araña o no (antes era cada hora; Juan lo cambió el 2026-10-20). Cada ejecución sigue este orden:

1. **Leer valoraciones.** Son issues con la etiqueta `valoracion`; el cuerpo trae un bloque JSON con notas de 1 a 5 por mejora y la confirmación de hitos.
   - Añadir un resumen a `evolucion/valoraciones.md`: fecha, versión, nota media y comentarios.
   - **Nota 1–2:** quitar o rehacer esa mejora en esta misma ejecución.
   - **Nota 4–5:** seguir en esa dirección.
   - **Hito confirmado** («funciona ✓») → `estado: "conseguido"` en `objetivo.json`. Si «no funciona ✗» → `en_curso`, y arreglarlo.
   - Comentar el issue con lo que se ha hecho con sus notas y cerrarlo.
2. **Atender todas las peticiones** `nueva-habilidad` abiertas, en cada ejecución y sin límite (lo pidió Juan el 2026-10-20), como explica la sección de arriba. Cada una acaba implementada, cerrada con `no-posible` y una alternativa, o con `necesita-info`. Si una es grande, se hace la parte que se pueda terminar y se deja abierta explicando qué falta. Se suman a las 2–4 mejoras propias; no las sustituyen.
3. **Publicar una versión con 2–4 mejoras, sobre todo en las apps nativas** (la web recibe arreglos y lo que necesite Android). Mezclar tipos: `funcionalidad`, `grafica`, `iniciativa`, `diseño`, `arreglo`.
   - **Al menos una mejora por versión debe acercar a la araña al objetivo** (ver `OBJETIVO.md`) y llevar `"hito": "hN"`.
   - **Al menos otra debe acercarla a un asistente tipo Siri** (`"hito": "asistente"`; ver la sección de `OBJETIVO.md`).
   - Si un hito necesita que Juan haga algo en su iPhone, poner `estado: "listo_para_juan"`, rellenar `juan` con la tarea en una frase y `guia` con un enlace a la guía paso a paso en `nativo/`.
   - Pequeñas, terminadas y probables en 2 minutos. Nada a medias.
   - Cada mejora se apunta en `cambios.json`, al principio de la lista: `{"v","fecha","mejoras":[{"id":"v-n","tipo","titulo","detalle","probar","hito?"}]}`. Juan las valora desde la app.
   - Subir `version.json` (minor) y `const V` en `sw.js`.
4. **Calidad antes de publicar:**
   - `node --check` del script.
   - Una prueba en jsdom que abra la app sin errores con el agente de usuario de iPhone, de Android (`?app=android`, con un `AranaAndroid` falso) y de ordenador, y abra Ajustes, Evolución y «Valorar mejoras» (`__arana.settings()`, `__arana.evo()`, `__arana.rate()`). En jsdom el agente de usuario se pasa con `new ResourceLoader({userAgent})`.
   - JSON válidos.
   - Si algo falla y no se arregla en esa ejecución, no publicar.
5. **Diario.** Añadir una línea a `evolucion/diario.md`: hora, versión, qué se hizo, qué hito se trabajó y el siguiente paso previsto.

### Freno

- Si las dos últimas valoraciones tienen nota media menor que 3, la siguiente versión solo arregla y pule. Nada nuevo.
- Si hay 6 versiones seguidas sin ninguna valoración de Juan, publicar como mucho una mejora por hora, priorizando el objetivo.
- No sumar más de unas 600 líneas por versión. Si `index.html` pasa de unas 3000 líneas, la mejora de esa hora es dividirlo en `js/*.js`, sin compilación.

### Sorpresa: el dado de cada hora

Juan quiere sorpresas y condiciones nuevas. Al empezar cada ejecución, tirar el dado con `python3 -c "import random;print(random.random(),random.random())"`. El primer número decide la mejora sorpresa y el segundo, la condición.

- **Mejora sorpresa (primer número < 0,5):** una de las mejoras de la versión es algo que nadie ha pedido y que no sigue la línea anterior. Va con `"tipo": "sorpresa"`. Debe poder quitarse sin romper nada, y si Juan le pone 1–2 se quita en la siguiente hora.
- **Condición de la hora (segundo número < 0,6):** elegir al azar una de esta lista y aplicarla a toda la versión.
  1. Una mejora visual atrevida en la araña o en la pantalla.
  2. Un rasgo nuevo de personalidad: costumbres, manías, una historia propia.
  3. Una gráfica nueva en Evolución con datos que ya existen.
  4. Quitar o simplificar algo que sobre; al menos una mejora consiste en restar.
  5. Una idea traída de otro campo: juegos, música, deporte, cocina.
  6. Un minijuego o un momento de juego con la araña.
  7. Accesibilidad: tamaño, contraste, voz o uso con una mano.
  8. Una iniciativa nueva que la araña proponga por su cuenta, siempre preguntando.
  9. Velocidad o ahorro: que algo vaya más rápido o gaste menos API.
  10. Una mejora pensada para usar la araña de noche o a oscuras.
- **Lo que el dado no cambia:** las reglas de calidad, el freno, la seguridad, ni la obligación de incluir una mejora hacia el objetivo y otra de asistente. Una mejora puede cumplir varias cosas a la vez.
- **Apuntarlo:** el resultado del dado va en `evolucion/diario.md`, y la condición elegida en el `detalle` de alguna mejora de `cambios.json`.

## Ajedrez (`ajedrez/`, desde la 0.24.0)

- La araña juega al ajedrez y su cerebro evoluciona (red de detectores + algoritmo genético). **El diseño es de Juan** y se construye por fases (ver `ajedrez/DISENO.md`). La tarea diaria **no cambia el diseño** del ajedrez ni añade fases por su cuenta: solo arregla fallos o lo que Juan pida en una petición.
- `motor.js`: reglas, detectores, búsqueda y evolución; funciona en la web, en los hilos y en Node. `worker.js`: un hilo de partidas. `sala.js` + `index.html`: la sala.
- Se abre con «vamos a jugar al ajedrez» / «entrena» (`chessCmd` y `openChess` en `index.html`) como un `<iframe id="ajz">`; la sala avisa con `postMessage({arana:'ajedrez-salir'})`.
- Guarda en IndexedDB `arana-ajedrez` (aparte de la memoria del asistente). No se cambian sus nombres ni se borran datos.
- La sala habla con las apps nativas: en la app de iPhone por `window.webkit.messageHandlers.arana` (`Ajedrez.swift`: `salir`, `hito`, `guardar`), en Android por `AranaAndroid.guardarArchivo` y `AranaAndroid.pantalla` (`MainActivity.kt`), y en la web por `postMessage` al `index.html` de Araña. La sala debe seguir funcionando sin ellos (APK o app antiguos).
- `stockfish/`: Stockfish 19 lite de un hilo (GPL v3, ver su `LEEME.md`). No se modifica ni se cambia por la versión grande (94 MB) ni por la de varios hilos (necesita cabeceras que GitHub Pages no da).
- Explicación completa del diseño para Juan: `ajedrez/README.md`. Si cambia algo del funcionamiento, se actualiza ahí también.
- **Lichess** (0.30.0): la araña juega con una cuenta BOT desde la sala (`lichess()` en `sala.js`). El token lo pega Juan y se guarda solo en `localStorage` `arana.ajedrez.lichess`; nunca va en el repo. chess.com no admite bots: no se ofrece.
- **Motor UCI** (`exportarMotor`): un `.js` con `motor.js` dentro, los genes y un bucle UCI para Node. Si cambia la API de `motor.js` (`Pos`, `parseUci`, `uci`, `Buscador`, `compilar`), se comprueba que el motor exportado sigue funcionando.
- **Segundo plano**: iPhone con `UIBackgroundModes: audio` (audio en silencio desde la sala, `Entreno` en `Ajedrez.swift`) y avisos locales; Android con el servicio `Entreno.kt` (primer plano, `specialUse`). Sin internet gracias a `sw.js` (y `WKAppBoundDomains` en iOS).
- **Elo** (0.32.0): escala normal anclada a la escalera (`ELO_PELDANO`, `anclaElo`, `migrarTodoElo` en `sala.js`). Si cambian los peldaños, se recalibra (no se inventan Elos) y se explica en `ajedrez/README.md`. `est.eloReal` marca lo ya migrado: no se vuelve a migrar.
- **Rendimiento**: niveles `MODOS` (Ahorro, Equilibrado, Máximo) que elige Juan. **No se cambian solos** (0.33.0: Juan pidió quitar la bajada automática por calor y batería). `medida()` (banco de pruebas de `worker.js`) solo sirve para el tiempo automático.
- **Servidor Linux** (`servidor/`, 0.33.0): Node sin paquetes de npm + Chromium headless con la misma sala (`?plat=linux`) y un visor por SSE en el puerto 8733, solo para Tailscale; servicio de usuario de systemd (`instalar.sh`). En `plat=linux` la sala no muestra «←», recuerda si entrenaba, vuelve a Lichess sola y cambia los `<select>` por una lista en la página (el visor no ve las listas del sistema). Si cambia la sala, se prueba también ahí (abrirla con `ARANA_CHROMIUM` y tocar por `/entrada`).
- **Gradiente** (0.35.0, distópica 39): `rasgosPos`, `ajustarGradiente` en `motor.js`; `etiquetarGradiente`, `afinarHijas` en `sala.js`; posiciones en IndexedDB `estado` clave `grad`. Si cambia un detector o `Ctx.add`, la prueba de gradiente comprueba que *medidas × pesos* sigue dando la valoración exacta. Los genes se redondean con `r6` (6 decimales).
- **Gráfica** (0.37.0, fase 1 de la red en la gráfica, ver `ajedrez/README.md`): `ajedrez/gpu.js` (WebGPU), `gpu.html`, `servidor/comun.js` (opciones de Chromium y llama-server) y `servidor/probar-gpu.js`. llama-server lo para Juan a mano (lo pidió el 2026-10-22): el servidor no lo toca salvo con `ARANA_LLAMA_AUTO=1`. Los kernels se comprueban siempre contra el procesador.
- **Red en la gráfica** (0.38.0, distópica 40, fase 2): `ajedrez/red.js` y los kernels de entrenamiento de `gpu.js`; la sala la entrena solo en Linux (`redActiva`, `entrenarRed`; datos en `estado` claves `red40datos` y `red40`). Se comprueba con `servidor/probar-gpu.js --red` en el Arch de Juan (exactitud, gradientes, aprendizaje, `--barrido 1`); aquí, con la gráfica simulada (`ARANA_GPU_SIMULADA=1`).
- **La red juega** (0.39.0, fase 3): `ajedrez/mcts.js` (MCTS por lotes) y `partidaRed` en `sala.js`; velocidad en la 5080 con `probar-gpu.js --red --mcts 1`.
- **Población de redes** (0.40.0, fase 4): `cicloRedes`, `entrenarUna`, `jugarUna`, `explotarExplorar` en `sala.js` y `Red.rehacer`; se guarda en `estado` clave `red40pob` (nunca se borra; las redes de otra forma se descartan al cargar).
- **Autojuego en la gráfica** (0.41.0): `bucleAuto`, `partidaAuto`, `agrupadorAuto`, `entrenarConAuto` en `sala.js`; arranca con `entrenar(true)` si `redActiva()`; `cicloRedes` lo pausa al cerrar la generación. Juan quiere que el procesamiento vaya a la 5080.
- Antes de publicar un cambio en `ajedrez/`: `node ajedrez/pruebas/reglas.js` (perft y simetría), `node ajedrez/pruebas/evolucion.js 1`, `node ajedrez/pruebas/stockfish.js`, `node ajedrez/pruebas/gradiente.js` y `node ajedrez/pruebas/mcts.js`.
