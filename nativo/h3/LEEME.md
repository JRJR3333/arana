# Hito h3 · Automatizaciones de iOS

**Qué consigue:** sus rutinas saltan solas a una hora, al llegar a un sitio, al conectarse a un Wi-Fi o al abrir una app. La araña le prepara el texto; usted solo lo pega.

**Tiempo:** unos 5 minutos por automatización, desde el iPhone. El atajo **Araña** no se toca.

## 1. Copiar la receta

1. Abra la araña → **Evolución** → **Recetario de rutinas**.
2. Junto a cada rutina verá la hora a la que suele hacerla.
3. Pulse **Copiar enlace** (sirve para todo).
   Si la rutina es solo de ajustes (Wi-Fi, brillo, No molestar…), también verá **Copiar texto del atajo**, que funciona sin abrir Safari.

Si el recetario está vacío: bautice una rutina («llama a esto modo cine: brillo al 20 y no molestar») o repita algo tres días a la misma hora.

## 2. Crear la automatización

1. Abra **Atajos** → pestaña **Automatización** → **+** (Nueva automatización).
2. Elija el disparador: **Hora del día**, **Llegar**, **Wi-Fi**, **App** (al abrir una app), **Modo de concentración**…
3. Marque **Ejecutar inmediatamente** y desactive **Notificar al ejecutarse** si no quiere aviso.
4. Toque **Nueva automatización en blanco** y añada una acción:
   - Con el **enlace**: acción **Abrir URL** y pegue el enlace copiado.
   - Con el **texto del atajo**: acción **Ejecutar atajo** → elija **Araña** → toque *Entrada* → **Texto** y pegue el texto copiado (por ejemplo `brillo|20;nomolestar|on`).
5. Pulse **OK**.

Debe quedar así:

```
Cuando: Hora del día, 23:00, a diario
Hacer:  Abrir URL  https://jrjr3333.github.io/arana/?q=modo%20noche
```

o, solo con ajustes:

```
Cuando: Hora del día, 23:00, a diario
Hacer:  Ejecutar atajo  Araña   (Entrada: brillo|20;nomolestar|on)
```

## Bueno saber

- El texto con varias órdenes separadas por `;` necesita el hito h1 (atajo «Araña» dentro de «Repetir con cada»). Con una sola orden funciona ya.
- Con el enlace se abre Safari y la araña hace la rutina al cargar (como en h2). Si la rutina desconecta algo, le pedirá confirmación.
- Si cambia la rutina en la araña, el enlace sigue valiendo: va por su nombre.

## Confirmar el hito

Abra la araña → **Evolución** → hito «Automatizaciones de iOS» → **Ya funciona**. Si algo falla, pulse **No me funciona** y lo reviso en la siguiente hora.
