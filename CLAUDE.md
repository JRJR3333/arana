# Instrucciones para Claude: cómo actualizar Araña

Araña es la app personal de Juan para iPhone. Es una web app instalada en la pantalla de inicio y alojada en GitHub Pages desde la rama `master`. Este archivo explica cómo atender sus peticiones de nuevas habilidades.

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

- Una petición por commit.
- Si una petición es ambigua, comentar con una pregunta concreta y dejarla abierta con la etiqueta `necesita-info`.
- Nunca borrar datos del usuario ni cambiar el nombre del atajo `Araña`.
