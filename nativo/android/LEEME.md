# La araña para Android

**Qué es:** la misma araña de la web, dentro de su propia app de Android (`nativo/android/`, Kotlin, sin librerías). Se compila sola en la nube (pestaña **Actions** → «App Android») cada vez que cambia.

## Instalarla (2 minutos, en el móvil Android)

1. En el móvil Android, abra en Chrome: <https://github.com/JRJR3333/arana/releases/download/android/arana.apk>
2. Pulse el archivo descargado. Si Android lo pide, permita **Instalar apps desconocidas** para Chrome.
3. Abra «Araña». La primera vez, ponga la clave de Claude en Ajustes, igual que en el iPhone (la clave se queda en ese móvil).

En Android no hace falta cuenta de desarrollador ni pagar nada.

## Mandar mejoras (para su hermano)

- Cuando la araña no sabe algo, la apunta en Evolución → «Lo que aún no sé hacer». El botón «Pedir a Claude» abre GitHub con la petición escrita.
- Hace falta una cuenta de GitHub. Para que la petición llegue con su etiqueta y yo la atienda cada día, Juan debe añadirle como colaborador: GitHub → JRJR3333/arana → Settings → Collaborators → Add people.

## Qué sabe ya

- Todo lo de la web (cerebro Claude, apps, memoria, Evolución).
- En nativo: temporizadores y alarmas del reloj (`arana://temporizador?min=5`, `arana://alarma?hora=7&min=30`).

## Qué falta

- Que la web use esas órdenes nativas cuando corre dentro de la app Android.
- Micrófono propio, avisos y widget de Android.

## Actualizar

Cada versión nueva se descarga del mismo enlace. Mientras no haya llave de firma propia en GitHub Secrets (`ARANA_KEYSTORE_B64`, `ARANA_KEYSTORE_PASS`, `ARANA_KEY_ALIAS`), Android puede pedir desinstalar la anterior: antes, copie su memoria en Ajustes de la araña («Copiar mi memoria») para pegarla después.
