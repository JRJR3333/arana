# Instalar la araña desde el Mac

**Qué consigue:** la araña como app de verdad en su iPhone, con su icono, voz, «Oye Siri, Araña», el widget y el control del Centro de control.

**Tiempo:** unos 20 minutos la primera vez (casi todo es esperar a que baje Xcode). Las siguientes, 2 minutos.

**Coste:** gratis con su Apple ID. Con la cuenta gratuita la app **caduca a los 7 días**: para renovarla basta con conectar el iPhone al Mac y repetir el paso 4. Con la cuenta de desarrollador (99 $/año) dura un año.

## 1. Xcode (una vez)

1. En el Mac, abra la **App Store**, busque **Xcode** e instálelo. Es grande; tarda.
2. Ábralo una vez. Acepte la licencia y, cuando lo pregunte, descargue la plataforma **iOS**.
3. Vaya a **Xcode → Settings → Accounts**, pulse **+** → **Apple ID** e inicie sesión con su cuenta de Apple.

## 2. Preparar la araña

Abra **Terminal** (Cmd + Espacio, escriba «Terminal») y pegue esta línea:

```
curl -fsSL https://raw.githubusercontent.com/JRJR3333/arana/master/nativo/ios/instalar.sh | bash
```

Descarga la araña en la carpeta `Arana` de su usuario, prepara el proyecto y abre Xcode. No instala nada más en el Mac, salvo una herramienta pequeña (XcodeGen) en la carpeta oculta `.arana`.

## 3. Firmar con su cuenta (una vez)

En Xcode, en la columna de la izquierda:

1. Pulse el proyecto **Arana** (el icono azul de arriba).
2. En **TARGETS**, elija **Arana** → pestaña **Signing & Capabilities**.
3. Marque **Automatically manage signing** y en **Team** elija su nombre (*Personal Team*).
4. Repita lo mismo con el target **AranaIsla**.

> Si sale «Failed to register bundle identifier», cambie en los dos targets `com.jrjr3333` por algo suyo, por ejemplo `com.juanrj`. El de AranaIsla debe acabar en `.isla`.

## 4. Pasarla al iPhone

1. Conecte el iPhone al Mac con el cable, desbloquéelo y pulse **Confiar**.
2. En el iPhone: **Ajustes → Privacidad y seguridad → Modo de desarrollador** → activar. Se reinicia; al volver, confirme **Activar**.
3. En Xcode, arriba en el centro, elija su **iPhone** como destino.
4. Pulse **▶** (o Cmd + R). La primera vez tarda un par de minutos.
5. Si el iPhone dice «Desarrollador no fiable»: **Ajustes → General → VPN y gestión de dispositivos** → su Apple ID → **Confiar**. Vuelva a pulsar ▶.

La araña aparece en la pantalla de inicio. La primera vez le pedirá permisos (micrófono, voz, recordatorios, calendario) y la clave de Claude, que se guarda en el llavero del iPhone.

## Actualizar a una versión nueva

Vuelva a pegar la línea del paso 2 en Terminal y pulse ▶ en Xcode con el iPhone conectado. La firma ya queda recordada si no cambió el bundle identifier. Lo aprendido no se pierde.

## Si algo falla

- **«Xcode está instalado pero no activo»:** en Terminal, `sudo xcode-select -s /Applications/Xcode.app` y repita el paso 2.
- **«iOS xx is not installed»:** Xcode → Settings → Components → descargue iOS.
- **El iPhone no aparece como destino:** desbloquéelo, desenchufe y vuelva a enchufar el cable, y revise el modo de desarrollador.
- **A los 7 días no abre:** es la caducidad de la cuenta gratuita. Conecte el iPhone y pulse ▶ otra vez.
