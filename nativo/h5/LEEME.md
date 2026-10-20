# Hito h5 · Avisos con la app cerrada

**Qué consigue:** a la hora de cada rutina, el iPhone le pregunta si la hago, aunque la araña esté cerrada. Usted decide; la araña nunca actúa sola. Sin instalar nada: solo la app Atajos.

**Tiempo:** unos 5 minutos por aviso, desde el iPhone. El atajo **Araña** no se toca.

## 1. Copiar la pregunta y el enlace

1. Abra la araña → **Evolución** → **Avisos · con la app cerrada**.
2. La gráfica muestra a qué horas me usa. Las horas de sus recetas salen en azul.
3. Junto a cada receta con hora:
   - **Copiar pregunta** (por ejemplo: «Son las 23:00. ¿Hago «modo noche»?»).
   - **Copiar enlace** (el mismo del recetario).

Si no aparece ninguna, primero necesita una receta con hora (vea el hito h3).

## 2. Crear el aviso en Atajos

1. Abra **Atajos** → pestaña **Automatización** → **+**.
2. Elija **Hora del día**, ponga la hora de la receta y **A diario** (o los días que quiera).
3. Marque **Ejecutar inmediatamente** y deje activado **Notificar al ejecutarse**.
4. Toque **Nueva automatización en blanco** y añada:
   1. **Elegir del menú**. Toque *Mensaje* y pegue la pregunta. Deje dos opciones: **Sí** y **Ahora no**.
   2. Dentro de **Sí**: acción **Abrir URL** y pegue el enlace.
   3. Deje **Ahora no** vacío.
5. Pulse **OK**.

Debe quedar así:

```
Cuando: Hora del día, 23:00, a diario
Hacer:  Elegir del menú «Son las 23:00. ¿Hago «modo noche»?»
          Sí       → Abrir URL  https://jrjr3333.github.io/arana/?q=modo%20noche&a=...
          Ahora no → (nada)
```

**Más sencillo todavía:** en el paso 3 elija **Preguntar antes de ejecutar** y ponga solo **Abrir URL**. El iPhone le mostrará una notificación y la rutina se hace solo si la toca.

## Bueno saber

- Si la pantalla está bloqueada, verá un aviso; tóquelo para que aparezca el menú.
- Si la receta es solo de ajustes, en el paso 4.2 puede usar **Ejecutar atajo** → **Araña** con el «texto del atajo» del recetario, sin abrir Safari.

## Confirmar el hito

Abra la araña → **Evolución** → hito «Avisos con la app cerrada» → **Ya funciona**. Si algo falla, pulse **No me funciona** y lo reviso en la siguiente hora.
