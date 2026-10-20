# Araña

Asistente personal en forma de araña para iPhone. Vive en la pantalla de inicio como una app web. Camina entre sus "estaciones" y lanza la tela para hacer cosas en el iPhone:

- abrir apps,
- cambiar ajustes,
- llevar textos de una app a otra.

Usa **Atajos de iOS** como manos. Lo que iOS no permite, lo dice.

## Qué hace y qué no

| Puede | Cómo |
|---|---|
| Abrir Notas, Mapas, Música, Fotos, Calendario, Correo, Recordatorios y WhatsApp | Enlace directo a la app |
| Wi-Fi, Bluetooth, brillo, No molestar, modo oscuro, linterna, bajo consumo y datos móviles | Atajo «Araña» |
| Llevar un texto a otra app | Lo copia, abre la app y usted pega |
| Preparar un WhatsApp con texto | Abre WhatsApp con el mensaje; usted elige el contacto y pulsa enviar |

| No puede (iOS no lo permite) | Qué dice |
|---|---|
| Tocar botones dentro de otras apps | Lo explica |
| Mover iconos de la pantalla de inicio | Lo explica |
| Leer lo que hay en otras apps | Le pide que le pegue el texto en el bolsillo |
| Instalar o borrar apps | Lo explica |

## Cómo aprende

- **Le entiende o le pregunta.** Si no entiende una orden, propone hasta 3 opciones. La que usted elige queda asociada a esa frase.
- **Le premia.** Al volver de cada tarea pregunta «¿Lo hice bien?»:
  - «Bien» suma +2 a esa frase.
  - «Mal» resta −3, y con −2 la frase se olvida.
- **Deja de preguntar.** En el modo «Según lo aprendido», cuando una frase llega a +4 (o una acción sale bien 3 veces sin fallos), deja de pedir permiso.
- **Avisa de lo que falla.** Si una acción ha fallado más veces de las que ha salido bien, avisa y vuelve a preguntar.
- **Se puede revisar.** Todo se ve y se borra en *Ajustes → Lo que he aprendido*. La memoria se queda solo en su iPhone.

---

## Instalación (una vez)

### 1. Publicar en GitHub Pages

1. Suba esta carpeta a un repositorio público, por ejemplo `arana`.
2. En el repositorio, vaya a *Settings → Pages → Build and deployment*.
3. Elija *Deploy from a branch*, la rama `main` y la carpeta `/ (root)`.
4. En un minuto estará en `https://SU-USUARIO.github.io/arana/`.

### 2. Ponerla en la pantalla de inicio

1. Abra esa dirección en **Safari** en el iPhone.
2. Pulse *Compartir* (el cuadrado con la flecha) y luego **Añadir a pantalla de inicio**.
3. Ábrala siempre desde el icono, no desde Safari. Así se ve a pantalla completa y conserva lo aprendido.

### 3. Crear el atajo «Araña» (las manos)

La app manda al atajo un texto del tipo `accion|valor`, por ejemplo `wifi|off` o `brillo|30`.

Abra **Atajos**, pulse **+** y llame al atajo exactamente **Araña** (con ñ). Después añada estas acciones en orden. Los nombres pueden variar un poco según la versión de iOS; busque cada acción en el buscador de acciones.

**A. Separar la orden**

1. **Dividir texto**. Texto: *Entrada del atajo*. Separador: *Personalizado* → `|`
2. **Obtener elemento de la lista** → *Primer elemento* de *Texto dividido*.
3. **Definir variable** → nombre `accion`.
4. **Obtener elemento de la lista** → *Último elemento* de *Texto dividido*.
5. **Definir variable** → nombre `valor`.

**B. Un bloque «Si» por cada orden**

Para los ajustes de encender y apagar, use dos «Si» anidados:

```
Si  accion  es  wifi
    Si  valor  es  on
        Definir Wi-Fi → Activado
    Si no
        Definir Wi-Fi → Desactivado
    Fin
Fin
```

Repita el mismo esquema con estas acciones:

| `accion` | Acción de Atajos | `on` | `off` |
|---|---|---|---|
| `wifi` | Definir Wi-Fi | Activado | Desactivado |
| `bluetooth` | Definir Bluetooth | Activado | Desactivado |
| `nomolestar` | Definir concentración → No molestar | Activar | Desactivar |
| `oscuro` | Definir aspecto | Oscuro | Claro |
| `linterna` | Definir linterna | Activado | Desactivado |
| `bajoconsumo` | Definir modo de bajo consumo | Activado | Desactivado |
| `datos` | Definir datos móviles | Activado | Desactivado |

El brillo y la prueba de conexión son distintos:

```
Si  accion  es  brillo
    Calcular  valor ÷ 100
    Definir brillo → Resultado del cálculo
Fin

Si  accion  es  test
    Mostrar notificación → «Araña conectada»
Fin
```

> **Brillo.** Si el brillo queda al mínimo, quite el «Calcular» y pase `valor` directamente. Depende de la versión de iOS.

**C. Probar.** En la app vaya a *Ajustes → Probar el atajo «Araña»*. Debe aparecer la notificación «Araña conectada».

La primera vez, iOS pedirá permiso para abrir Atajos y cada app; diga que sí. Al terminar un atajo, vuelva con el **◀ Araña** de la esquina superior izquierda. La araña le preguntará si salió bien.

---

## Órdenes de ejemplo

- `abre Notas` · `abre el calendario`
- `apaga el wifi` · `enciende el bluetooth` · `brillo al 30` · `sube el brillo`
- `pon no molestar` · `quita el modo oscuro` · `activa la linterna`
- `envía por WhatsApp: llego en diez minutos`
- `guarda esto` (abre el bolsillo) · `lleva esto a Notas`

Para hablarle, use el **dictado del teclado** (el micro junto a la barra espaciadora). En el modo de pantalla completa, iOS no deja usar el micrófono de la web directamente.

## Tocar la araña

- **Tocar**: muestra un menú con el bolsillo y lo aprendido.
- **Arrastrar**: la mueve.
- **Tocar mientras trabaja**: se detiene.
- Tras unos segundos sin nada que hacer, se recoge en el borde.

## Añadir apps

Edite la lista `APPS` en `index.html` con el nombre, el enlace de la app (su "URL scheme") y las palabras con las que la llamará. Por ejemplo:

```js
{id:'spotify', name:'Spotify', url:'spotify://', c:3, al:['spotify']}
```

Si una app no tiene enlace, se puede abrir desde el atajo con un bloque `Si accion es abrir` y la acción *Abrir app*.

## Siguientes pasos

1. **Cerebro con IA.** Conectar la API de Claude para entender órdenes libres y encadenar pasos, manteniendo la memoria de premios.
2. **App nativa.** Si más adelante hay un Mac, pasarla a Swift con *App Intents*. Así podría tener widget, órdenes por Siri y acciones propias sin pasar por la app Atajos.
