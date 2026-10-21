# Araña

Asistente personal en forma de araña. Tiene **la misma pantalla en todas partes**: el fondo de rejilla, la telaraña que crece con cada orden cumplida, el bocadillo, la araña de puntos y líneas, y abajo el micro, el campo «Dígame qué hacer» e «Ir». Lo demás está en **Ajustes** (la rueda de arriba a la derecha).

Hay tres versiones. Se ven igual; cambia lo que el móvil le deja hacer:

| Versión | Dónde está | Qué puede hacer |
|---|---|---|
| **Android** (la que más hace) | `nativo/android/` | Abrir sus apps, ajustes del móvil (linterna, brillo, No molestar; Wi-Fi, datos y Bluetooth abren su panel), temporizadores, alarmas, música (poner, pausar, siguiente), citas en el calendario, llamar, mensajes, WhatsApp, bolsillo, flotar sobre las demás apps y cerrarse |
| **App de iPhone** | `nativo/ios/` | Abrir apps, recordatorios, temporizadores, citas y agenda, música de su biblioteca, llamar, mensajes, metrónomo, widget, Centro de control e Isla Dinámica |
| **Web** (iPhone, Android o PC) | `index.html` | En el iPhone: abrir apps por su enlace, ajustes con el atajo «Araña», WhatsApp, llamar y bolsillo. En un ordenador: contestar, pensar y guardar en el bolsillo |

En *Ajustes → Lo que puedo hacer en…* cada versión enseña su propia lista. El cerebro (Claude) recibe solo los pasos que ese aparato permite.

| No puede (ningún móvil lo permite) | Qué dice |
|---|---|
| Tocar botones dentro de otras apps | Lo explica |
| Mover iconos de la pantalla de inicio | Lo explica |
| Leer lo que hay en otras apps | Le pide que le pegue el texto en el bolsillo |
| Instalar o borrar apps | Lo explica |

## Ajedrez

La araña también juega al ajedrez con un cerebro que evoluciona solo (detectores de posición + algoritmo genético) y sube una escalera contra Stockfish. Se abre con el **botón del caballo** (arriba, junto a la rueda) o diciendo «vamos a jugar al ajedrez». Puede jugar en **Lichess** con una cuenta BOT y exportarse como **motor UCI** para el ordenador. Cómo funciona todo, con las mutaciones y el torneo: [`ajedrez/README.md`](ajedrez/README.md).

## Cómo aprende

- **Le entiende o le pregunta.** Si no entiende una orden, propone hasta 3 opciones. La que usted elige queda asociada a esa frase.
- **Le premia.** Al volver de cada tarea pregunta «¿Lo hice bien?»:
  - «Bien» suma +2 a esa frase.
  - «Mal» resta −3, y con −2 la frase se olvida.
- **Deja de preguntar.** En el modo «Según lo aprendido», cuando una frase llega a +4 (o una acción sale bien 3 veces sin fallos), deja de pedir permiso.
- **Avisa de lo que falla.** Si una acción ha fallado más veces de las que ha salido bien, avisa y vuelve a preguntar.
- **Se puede revisar.** Todo se ve y se borra en *Ajustes → Lo que he aprendido*. La memoria se queda solo en su móvil.

---

## Instalación de la web en el iPhone (una vez)

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
- `apaga el wifi` · `brillo al 30` · `pon no molestar` · `enciende la linterna`
- `envía por WhatsApp: llego en diez minutos`
- `guarda esto` (abre el bolsillo) · `lleva esto a Notas`
- En Android: `temporizador de 5 minutos` · `alarma a las 7 y media` · `pausa la música` · `flota` · `sal de la app`

Para hablarle, pulse el micro de abajo a la izquierda o toque la araña. En la web del iPhone, si el micro no está disponible, use el dictado del teclado.

## Tocar la araña

- **Tocar**: le escucha.
- **Tocar mientras trabaja**: se detiene.
- **Rueda de arriba**: Ajustes, con Evolución, Valorar mejoras, lo aprendido, el bolsillo y la memoria.

## Añadir apps

Añada una línea a `CAT_SRC` en `index.html`: `id|nombre|enlace (URL scheme)|color|otras formas de llamarla`. Por ejemplo:

```
spotify|Spotify|spotify://|#111111|
```

En Android no hace falta el enlace: la araña busca la app instalada por su nombre. Para cambiar el enlace de una app sin tocar código, pídale que la abra; si no sabe, ofrece «Poner enlace».
