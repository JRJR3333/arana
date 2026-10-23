# La araña para Android

**Qué es:** la araña con la misma pantalla que la app de iPhone, dentro de su propia app de Android (`nativo/android/`, Kotlin, sin librerías). Es la versión que más hace. Se compila sola en la nube (pestaña **Actions** → «App Android») cada vez que cambia.

## Instalarla (2 minutos, en el móvil Android)

1. En el móvil Android, abra en Chrome: <https://github.com/JRJR3333/arana/releases/download/android/arana.apk>
2. Pulse el archivo descargado. Si Android lo pide, permita **Instalar apps desconocidas** para Chrome.
3. Abra «Araña». La primera vez, ponga la clave de Claude en Ajustes, igual que en el iPhone (la clave se queda en ese móvil).

En Android no hace falta cuenta de desarrollador ni pagar nada.

## Mandar mejoras (para su hermano)

- Cuando la araña no sabe algo, la apunta en Evolución → «Lo que aún no sé hacer». El botón «Pedir a Claude» abre GitHub con la petición escrita.
- Hace falta una cuenta de GitHub. Para que la petición llegue con su etiqueta y yo la atienda cada día, Juan debe añadirle como colaborador: GitHub → JRJR3333/arana → Settings → Collaborators → Add people.

## Qué sabe ya

- La misma pantalla que en el iPhone: telaraña, bocadillo, la araña, micro, campo e «Ir». Todo lo demás (Evolución, Valorar mejoras, el bolsillo, la memoria) está en Ajustes, la rueda de arriba.
- El cerebro Claude, la memoria y lo aprendido, como en la web.
- En nativo (desde la 0.22.0, órdenes `arana://` con respuesta):
  - abrir las apps instaladas por su nombre (`abrir`),
  - ajustes (`ajuste`): linterna, brillo, No molestar y, en Android 9 o menos, Wi-Fi, los hace ella; Wi-Fi, datos, Bluetooth, tema oscuro y ahorro de batería abren su panel para que usted toque,
  - temporizadores y alarmas del reloj (`temporizador`, `alarma`),
  - música: poner, pausar, siguiente y anterior en la app que esté sonando (`musica`),
  - citas en el calendario (`evento`), llamar (`llamar`) y mensajes (`mensaje`),
  - oír con el micro de Android, hablar con su voz, flotar sobre las demás apps (`flotar`) y cerrarse (`salir`).

## Permisos que pide una sola vez

- **Brillo de todo el móvil:** «Modificar ajustes del sistema» para la Araña. Sin él, cambia solo el brillo de la araña.
- **No molestar:** acceso a «No molestar» para la Araña.
- **Flotar:** «Mostrar sobre otras apps».

La araña abre la pantalla de Android donde se concede; después, vuelva a pedírselo.

## Qué falta

- Avisos con la app cerrada y widget de Android.

## Actualizar

Cada versión nueva se descarga del mismo enlace y, desde la 0.42.0, se instala encima de la anterior sin perder nada: todas salen firmadas con la misma llave (guardada en la caché de GitHub Actions, no en el repo). Si la app es antigua, la araña lo avisa al abrir, copia su memoria y abre la descarga.

La primera vez que pase de una app anterior a la 0.42.0, Android puede pedir desinstalar la vieja: pegue después la memoria en Ajustes de la araña. Si Juan pone su propia llave en GitHub Secrets (`ARANA_KEYSTORE_B64`, `ARANA_KEYSTORE_PASS`, `ARANA_KEY_ALIAS`), se usa esa.
