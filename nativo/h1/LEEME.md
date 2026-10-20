# Hito h1 · Varias órdenes en un solo salto

**Qué consigue:** la araña manda varios ajustes juntos (por ejemplo `wifi|off;bluetooth|off;brillo|30`) y el atajo «Araña» los hace todos seguidos, sin volver a la web entre uno y otro.

**Tiempo:** unos 5 minutos, desde el iPhone. No hace falta crear nada nuevo: solo se mete lo que ya tiene dentro de un «Repetir».

> No cambie el nombre del atajo: debe seguir llamándose **Araña**. Las órdenes sueltas (`wifi|off`) seguirán funcionando igual.

## Pasos

1. Abra **Atajos** y mantenga pulsado el atajo **Araña** → **Editar**.
2. Arriba del todo, **antes** de todo lo demás, añada:
   - **Dividir texto**. Texto: *Entrada del atajo*. Separador: *Personalizado* → `;` (punto y coma).
3. Justo debajo, añada **Repetir con cada** → elementos de *Texto dividido*.
4. Arrastre **todas** las acciones que ya tenía (el «Dividir texto» por `|`, las variables `accion` y `valor` y todos los bloques «Si») **dentro** del «Repetir con cada», antes de «Fin de Repetir».
5. En el primer «Dividir texto» que ya tenía (el del separador `|`), cambie *Entrada del atajo* por **Elemento repetido**. Toque el campo y elija la variable *Elemento repetido*.
6. (Opcional) Antes de «Fin de Repetir», añada **Esperar** → 1 segundo. Ayuda si algún ajuste tarda en aplicarse.
7. Pulse **OK** para guardar.

Debe quedar así:

```
Dividir texto  [Entrada del atajo]  por  ;
Repetir con cada elemento en  [Texto dividido]
    Dividir texto  [Elemento repetido]  por  |
    Obtener elemento: primero  → accion
    Obtener elemento: último   → valor
    Si accion es wifi … Fin
    Si accion es bluetooth … Fin
    … (el resto de bloques «Si»)
Fin de Repetir
```

## Activarlo en la araña

1. Abra la araña → **Ajustes** → *Conexión con Atajos* → **Varias órdenes en un salto** → *Mi atajo ya sabe*.
2. Pulse **Probar dos avisos**. Deben salir **dos** notificaciones «Araña conectada». Si solo sale una, revise el paso 5.
3. Pruebe: escriba «apaga el wifi y el bluetooth».

## Confirmar el hito

En la araña → **Evolución** → hito *Varias órdenes en un solo salto* → **Ya funciona**. Después envíe sus valoraciones para que Claude lo sepa.
