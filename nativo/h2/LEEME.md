# Hito h2 · «Oye Siri, Araña»

**Qué consigue:** dice «Oye Siri, Araña voz», dicta la orden y la araña la ejecuta al abrirse, sin escribir nada.

**Tiempo:** unos 5 minutos, desde el iPhone. Es un atajo nuevo y pequeño; el atajo **Araña** no se toca.

## Pasos

1. Abra **Atajos** → **+** (nuevo atajo).
2. Toque el nombre de arriba y póngale **Araña voz**. Ese nombre es la frase para Siri.
3. Añada la acción **Dictar texto**. Idioma: *Español (España)*. Dejar de escuchar: *Después de una pausa breve*.
4. Añada **Codificar URL** (en algunas versiones se llama «Codificar como URL»). Entrada: *Texto dictado*.
5. Añada **Texto** y escriba, sin espacios:
   `https://jrjr3333.github.io/arana/?q=`
   y justo detrás inserte la variable *Texto codificado como URL*.
6. Añada **Abrir URL**. Entrada: el *Texto* del paso anterior.
7. Pulse **OK**.

Debe quedar así:

```
Dictar texto  (Español)
Codificar URL  [Texto dictado]
Texto  https://jrjr3333.github.io/arana/?q=[URL codificada]
Abrir URL  [Texto]
```

## Probarlo

1. Diga: «Oye Siri, Araña voz».
2. Cuando escuche, diga por ejemplo «qué hora es» o «abre WhatsApp».
3. Se abre la araña, repite su orden («… Voy.») y la hace.

## Bueno saber

- Se abre en **Safari**, no en el icono de la pantalla de inicio: iOS no deja abrir la web instalada con un enlace. Funciona igual, con la misma memoria si usa la misma dirección. Si en Safari no le reconoce lo aprendido, es que iOS guarda por separado los datos de Safari y los del icono; las órdenes sueltas y las respuestas al instante funcionan igual.
- La orden se borra de la dirección al cargar, así que recargar no la repite.
- Para Siri basta el nombre del atajo. Si prefiere otra frase, renómbrelo (por ejemplo «Mayordomo»), pero **no** renombre el atajo «Araña».

## Confirmar el hito

Abra la araña → **Evolución** → hito «Oye Siri, Araña» → **Ya funciona**. Si algo falla, pulse **No me funciona** y lo reviso en la siguiente hora.

## Siguiente paso (h6)

Más adelante el atajo pensará solo, sin abrir Safari.
