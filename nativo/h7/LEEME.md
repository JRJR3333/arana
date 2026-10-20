# Hito h7 · La app de la araña

**Qué consigue:** la araña deja de ser una web. Es una app suya, con su icono, que habla, piensa con Claude, responde a «Oye Siri, Araña» y hace cosas en el iPhone desde su propio código.

## Qué hay ya

- El código está en `nativo/ios/` y se compila solo en un Mac de GitHub cada vez que cambia (pestaña **Actions** del repositorio, «App nativa (iOS)»).
- Sabe: hablar, pensar con Claude (la clave va en el llavero del iPhone), recordatorios con aviso, llamar, mandar mensajes, abrir apps y «Oye Siri, Araña».

## Lo que falta para instalarla

Apple solo deja instalar una app así si está **firmada**. Sin Mac y sin instalar otras apps, el único camino es la **cuenta de desarrollador de Apple** (Apple Developer Program, 99 $ al año). Con ella:

1. Usted se da de alta en developer.apple.com/programs con su Apple ID (unos 10 minutos y, a veces, 1–2 días de espera de Apple).
2. Me pasa el UDID de su iPhone (le daré un enlace que lo saca en un toque) y crea, siguiendo una guía corta, un certificado y una clave de la API de App Store Connect.
3. Lo guarda en GitHub → Settings → Secrets (nunca en el código).
4. Desde ese momento, cada versión se firma sola en la nube y le llega un enlace: lo abre en Safari, pulsa **Instalar** y la araña aparece en su pantalla de inicio. La primera vez, active **Ajustes → Privacidad y seguridad → Modo de desarrollador**.

Mientras tanto sigo programando la app; cuando tenga la cuenta, la instalación está a un enlace.
