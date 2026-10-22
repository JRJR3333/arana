# Araña en Linux (Arch, sin entorno gráfico)

El servidor deja a la araña **entrenando al ajedrez las 24 horas** en un ordenador con Linux y le deja **verla y manejarla desde el móvil** por Tailscale. No hace falta abrir Plasma ni ningún entorno gráfico: todo va por terminal y systemd.

## Cómo funciona

- `arana-servidor.js` abre la sala de ajedrez en un **Chromium sin ventana** (*headless*). Es la misma sala que la de la web y las apps, con todo lo que ya tienen: hilos de verdad, Stockfish, Lichess, el registro, las evoluciones…
- Su memoria (IndexedDB) se guarda en `~/.local/share/arana/chromium`, así que **sobrevive a los reinicios**. Si estaba entrenando, al reiniciar sigue entrenando; y si estaba conectada a Lichess, vuelve a conectarse.
- En el **puerto 8733** sirve un **visor**: la pantalla de la sala en directo. Desde el móvil se toca como si fuera la sala de verdad:
  - **tocar** = tocar;
  - **arrastrar** = moverse por la sala o por las listas;
  - **pellizcar** = zoom;
  - **⌨** = escribir en el campo que haya tocado antes (por ejemplo, el token de Lichess);
  - **⬇** = los archivos que guarda la sala («Exportar», «Exportar como motor»);
  - si la sala pide un archivo (Importar arañas), el visor le deja elegirlo del móvil;
  - **⟳** = volver a abrir la sala si algo se queda raro.
- **Solo acepta conexiones de Tailscale** (direcciones `100.64.0.0/10` y `fd7a:115c:a1e0::/48`) y del propio ordenador. Sin Tailscale no se puede entrar desde fuera.
- La pantalla solo se envía mientras hay un visor abierto. Si no lo hay, la araña entrena igual.
- Tiene **su propia evolución** (origen «linux», en rosa). Para pasar arañas entre aparatos se usa la Biblioteca: «Exportar copia» en uno, «Importar arañas» en otro.
- En el servidor, el nivel por defecto es **Máximo**: todos los núcleos menos uno. El servicio va con `Nice=10`, así que el resto del ordenador sigue respondiendo. El nivel se cambia en Opciones y no baja solo.

## Instalar (una vez)

```bash
sudo pacman -S --needed git nodejs chromium tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up            # si aún no está en su red de Tailscale
git clone https://github.com/JRJR3333/arana.git ~/arana
~/arana/servidor/instalar.sh
```

El script comprueba Node (22 o posterior) y Chromium, instala el servicio de usuario de systemd, activa *linger* (para que funcione sin iniciar sesión y al encender el ordenador) y le dice la dirección que tiene que abrir en el móvil, por ejemplo `http://mi-arch:8733`.

En el móvil: abra esa dirección con Tailscale encendido. En el iPhone puede añadirla a la pantalla de inicio (Compartir → Añadir a pantalla de inicio).

## Día a día

| Para | Orden |
|---|---|
| Ver qué hace | `journalctl --user -u arana -f` |
| Parar | `systemctl --user stop arana` |
| Arrancar | `systemctl --user start arana` |
| Reiniciar | `systemctl --user restart arana` |
| Que no arranque solo | `systemctl --user disable arana` |
| Actualizar ahora | `systemctl --user start arana-actualizar` |

- **Actualizaciones**: cada día a las 5:00, `arana-actualizar.timer` hace `git pull` y, si hay versión nueva, reinicia el servidor. Se pierde la generación que estaba a medias, porque se guarda al terminar cada generación.
- **Otro puerto**: `systemctl --user edit arana` y añada `Environment=ARANA_PUERTO=9000`. La sala de dentro usa el siguiente, 9001, solo en `127.0.0.1`.
- **Otra carpeta de datos**: `Environment=ARANA_DATOS=/ruta`.
- **Otro Chromium**: `Environment=ARANA_CHROMIUM=/usr/bin/google-chrome-stable`.
- **Aceptar cualquier red** (por ejemplo, la de casa sin Tailscale): `Environment=ARANA_ABIERTO=1`. No lo recomiendo.
- **Copia de seguridad**: la carpeta `~/.local/share/arana` entera, con el servicio parado. O, más fácil, «Exportar copia» desde el visor.

## Si algo falla

- *«No encuentro Chromium»*: `sudo pacman -S chromium`.
- *El visor no carga*: compruebe que el móvil tiene Tailscale encendido y que `systemctl --user status arana` dice *active (running)*.
- *Pantalla negra o congelada*: pulse ⟳ en el visor o `systemctl --user restart arana`.
- Si Chromium se cae, el servidor se cierra y systemd lo vuelve a arrancar a los 10 segundos. Si la sala se cuelga o se va a otra página, el servidor la vuelve a abrir en menos de un minuto.
