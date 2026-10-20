# Instrucciones para Claude: cómo actualizar Araña

Araña es la app personal de Juan para iPhone. Desde el 2026-10-20 el objetivo es que sea **una app nativa propia** (`nativo/ios/`, ver `OBJETIVO.md`); la web app de GitHub Pages (`index.html`, rama `master`) queda en mantenimiento. Este archivo explica cómo atender sus peticiones de nuevas habilidades.

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
   - **Una app nueva** se añade a `APPS` (id, nombre, URL scheme, color 1–6, palabras con las que se la llama).
   - **Un ajuste nuevo** se añade a `SETS` con su `sc`. En el comentario del issue se explica qué bloque añadir al atajo «Araña» en la app Atajos, con los nombres de las acciones en español.
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

- **Apps y ajustes:** lo que se añade a `APPS` o a `SETS` le llega al cerebro sin más.
- **Un tipo de paso nuevo** hay que añadirlo en cuatro sitios: el `enum` de `PLAN_TOOL`, la lista de pasos de `brainSystem()`, `toActs()` y `doAction()`/`urlFor()`.
- **Las reglas** (`rules()`) siguen siendo el plan B, para cuando no hay conexión ni clave.
- **Gastar poco** es un requisito de diseño:
  - lo que se pueda resolver en local (reglas, `mem`, `planCache`) no debe llamar a la API;
  - no se sube `max_tokens` ni se añade contexto a `brainSystem()` sin necesidad;
  - se respeta el tope diario (`capReached()`).

## Iconos

- Los iconos reales salen de la API pública de búsqueda de la App Store, por JSONP. Las apps de Apple se buscan por `bundleId` (`APPLE_BUNDLE`) y las demás por nombre.
- El enlace se guarda en `localStorage` (`arana.icons`).
- No se suben imágenes de iconos al repo.
- Las apps que no están en la tienda (`NO_STORE`) se quedan dibujadas.

## App nativa (`nativo/ios/`)

- SwiftUI, iOS 17+, proyecto generado con XcodeGen (`project.yml`). No se sube el `.xcodeproj`.
- Se compila en GitHub Actions (`.github/workflows/ios.yml`, macOS). Es la única compilación permitida: en la nube, nunca en el iPhone de Juan.
- Antes de dar algo por hecho, comprobar que el workflow del último commit está en verde (`gh api repos/JRJR3333/arana/actions/runs?per_page=1`). Si está rojo, leer el log del job y arreglarlo en esa misma ejecución.
- Funciones nuevas: dentro del código de la app (EventKit, App Intents, AVFoundation, WidgetKit, ActivityKit…), no en Atajos.
- Gastar poco con Claude, igual que en la web: `max_tokens` corto, sin historial largo.
- Firma: cuando Juan tenga cuenta de desarrollador, sus certificados van en *GitHub Secrets*, nunca en el repo.

## Modo evolución (cada hora)

Una tarea programada ejecuta a Claude cada hora, use Juan la araña o no. Cada ejecución sigue este orden:

1. **Leer valoraciones.** Son issues con la etiqueta `valoracion`; el cuerpo trae un bloque JSON con notas de 1 a 5 por mejora y la confirmación de hitos.
   - Añadir un resumen a `evolucion/valoraciones.md`: fecha, versión, nota media y comentarios.
   - **Nota 1–2:** quitar o rehacer esa mejora en esta misma ejecución.
   - **Nota 4–5:** seguir en esa dirección.
   - **Hito confirmado** («funciona ✓») → `estado: "conseguido"` en `objetivo.json`. Si «no funciona ✗» → `en_curso`, y arreglarlo.
   - Comentar el issue con lo que se ha hecho con sus notas y cerrarlo.
2. **Atender todas las peticiones** `nueva-habilidad` abiertas, en cada ejecución y sin límite (lo pidió Juan el 2026-10-20), como explica la sección de arriba. Cada una acaba implementada, cerrada con `no-posible` y una alternativa, o con `necesita-info`. Si una es grande, se hace la parte que se pueda terminar y se deja abierta explicando qué falta. Se suman a las 2–4 mejoras propias; no las sustituyen.
3. **Publicar una versión con 2–4 mejoras, sobre todo en la app nativa** (la web solo recibe arreglos). Mezclar tipos: `funcionalidad`, `grafica`, `iniciativa`, `diseño`, `arreglo`.
   - **Al menos una mejora por versión debe acercar a la araña al objetivo** (ver `OBJETIVO.md`) y llevar `"hito": "hN"`.
   - **Al menos otra debe acercarla a un asistente tipo Siri** (`"hito": "asistente"`; ver la sección de `OBJETIVO.md`).
   - Si un hito necesita que Juan haga algo en su iPhone, poner `estado: "listo_para_juan"`, rellenar `juan` con la tarea en una frase y `guia` con un enlace a la guía paso a paso en `nativo/`.
   - Pequeñas, terminadas y probables en 2 minutos. Nada a medias.
   - Cada mejora se apunta en `cambios.json`, al principio de la lista: `{"v","fecha","mejoras":[{"id":"v-n","tipo","titulo","detalle","probar","hito?"}]}`. Juan las valora desde la app.
   - Subir `version.json` (minor) y `const V` en `sw.js`.
4. **Calidad antes de publicar:**
   - `node --check` del script.
   - Una prueba en jsdom que abra la app sin errores, abra Evolución y abra «Valorar mejoras».
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
