# Objetivo final: que la araña salga de la web

**Meta:** que la araña deje de ser solo una página web y viva en el iPhone de Juan, con órdenes por voz, widgets, avisos y, al final, una app nativa. Hoy Juan no tiene Mac. Hay que avanzar con lo que permite un iPhone y la nube.

## Hitos y puntos

Los puntos de cada hito se suman al XP de la araña: cuanto más cerca está de salir de la web, más sube de nivel.

- Un hito vale el 30 % de sus puntos cuando está `listo_para_juan`.
- Vale el 100 % cuando Juan confirma en la app que funciona.

| Hito | Puntos | Camino previsto |
|---|---|---|
| h1 · Varias órdenes en un salto | 10 | El atajo «Araña» acepta `cmd|val;cmd|val` y los recorre con «Repetir con cada». La web manda la lista entera de una vez. |
| h2 · «Oye Siri, Araña» | 15 | Atajo «Araña voz»: dictado → abre la web con `?q=` y la orden se ejecuta al cargar. Después, h6. |
| h3 · Automatizaciones de iOS | 15 | Guías y textos listos para pegar en Automatización personal (hora, Wi-Fi, al abrir una app) que lanzan las rutinas aprendidas. La web exporta sus rutinas como órdenes del atajo. |
| h4 · A un toque | 20 | «Araña voz» como control del Centro de control, de la pantalla bloqueada o del botón de Acción (iOS 18). Rehecho en la 0.15.0 tras su ★★ al widget de carpetas. |
| h5 · Avisos con la app cerrada | 20 | Automatizaciones de Atajos a la hora de cada rutina con «Mostrar notificación» o «Elegir del menú», que lanzan la rutina. La web prepara el texto. |
| h6 · Cerebro fuera de la web | 25 | Atajo que llama a la API de Claude con «Obtener contenido de URL» (la clave la pone Juan en el atajo, nunca en el repo) y ejecuta el plan, sin Safari. |
| h7 · App nativa | 40 | Proyecto Swift en `nativo/ios/`, compilado con GitHub Actions (runner macOS) y firmado con la cuenta gratuita de Juan mediante AltStore desde su PC (o TestFlight si algún día tiene cuenta de desarrollador). |
| h8 · Isla Dinámica | 30 | Live Activity en la app nativa: la araña camina por la Isla mientras ejecuta una orden. |

## Mientras tanto: un asistente como Siri

En paralelo a los hitos, cada versión acerca a la araña a un asistente virtual de verdad. Toda versión incluye al menos una mejora con `"hito": "asistente"`. Ideas, de más a menos prioritaria:

1. **Conversación natural:** responde preguntas, sigue el hilo y recuerda lo dicho. Siempre en poco gasto.
2. **Voz:** contesta hablando. Más adelante, escucha sin pulsar con el atajo de Siri (h2) y con frases cortas de activación.
3. **Respuestas útiles al instante:** hora y fecha, cuentas, conversiones, cuenta atrás a fechas, traducciones. Lo que sea cálculo se resuelve en local y sin API.
4. **Tareas de asistente vía Atajos:** temporizadores, alarmas, recordatorios, eventos de calendario, llamar o enviar mensajes. Se añaden bloques al atajo «Araña» con su guía.
5. **Tarjetas de respuesta** (tiempo, agenda del día, próximos recordatorios), cuando haya fuente sin clave o mediante Atajos.
6. **Proactividad:** resumen al abrir por la mañana y sugerencias por hora, lugar o costumbre. Siempre proponiendo, nunca actuando sola.

Las mejoras del asistente no dan puntos de hito, pero sí cuentan en las valoraciones de Juan.

## Reglas

- **Sin instalar nada aparte** (lo pidió Juan el 2026-10-20). Solo la web, Safari y las apps que trae el iPhone, sobre todo Atajos. h7 y h8 quedan en pausa porque necesitan instalar otra app; no se trabajan salvo que Juan cambie de idea.

- **Toda pieza nativa vive en `nativo/`** con una guía `LEEME.md` en español, pensada para hacerla desde el móvil en menos de 10 minutos.
- **Ningún secreto en el repo.** Las claves las pone Juan en su dispositivo.
- **Orden de los hitos.** Se avanza en orden salvo que una valoración de Juan pida otra cosa. Se puede preparar el siguiente hito mientras el anterior espera a Juan.
- **El trabajo cuenta aunque Juan no responda.** Si un hito espera a Juan, recordárselo en la app (Evolución) y no repetir la petición en cada versión.
