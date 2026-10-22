# Araña juega al ajedrez

La araña juega al ajedrez con un cerebro que **no programa nadie a mano**: nace con unas ideas de ajedrez a medias, juega miles de partidas contra sus hermanas y contra Stockfish, y de generación en generación sobreviven y se cruzan las que mejor juegan. El diseño es de Juan; este documento explica cómo funciona todo por dentro. El resumen de decisiones y fases está en [`DISENO.md`](DISENO.md).

- [Dónde vive](#dónde-vive)
- [El cerebro de una araña](#el-cerebro-de-una-araña)
- [Cómo piensa una jugada](#cómo-piensa-una-jugada)
- [Una generación: torneo suizo, final y Stockfish](#una-generación-torneo-suizo-final-y-stockfish)
- [La puntuación](#la-puntuación)
- [Cómo nacen las hijas: selección, cruce y mutación](#cómo-nacen-las-hijas-selección-cruce-y-mutación)
- [El Elo](#el-elo)
- [Las distópicas](#las-distópicas)
- [El gradiente](#el-gradiente)
- [La sala](#la-sala)
- [Jugar fuera: Lichess y motor para el ordenador](#jugar-fuera-lichess-y-motor-para-el-ordenador)
- [Rendimiento: niveles](#rendimiento-niveles)
- [Linux sin pantalla (servidor)](#linux-sin-pantalla-servidor)
- [La red en la gráfica (en construcción)](#la-red-en-la-gráfica-en-construcción)
- [Sin internet y en segundo plano](#sin-internet-y-en-segundo-plano)
- [Dónde se guarda todo](#dónde-se-guarda-todo)
- [Archivos y pruebas](#archivos-y-pruebas)

---

## Dónde vive

- Se abre diciéndole a la araña «vamos a jugar al ajedrez» o «entrena», o con el **botón del caballo** de arriba a la derecha de la pantalla principal (al lado de la rueda de Ajustes).
- Es la misma página web (`ajedrez/index.html`) en las tres versiones: en la web, dentro de la app de iPhone (`nativo/ios/Arana/Ajedrez.swift`) y dentro de la de Android (que carga la web).
- Todo se calcula **en el propio aparato**: el motor está escrito en JavaScript (`motor.js`), sin librerías, y las partidas se juegan en paralelo en varios hilos (*Web Workers*, `worker.js`). Stockfish también va dentro (`stockfish/`).

## El cerebro de una araña

Cada araña es un **genoma**: una lista de números (con 6 decimales). Con esos números el motor construye su manera de valorar una posición y de buscar jugadas.

### Detectores (las medidas)

Hay **45 detectores de posición**. Cada uno mira una cosa concreta del tablero y la cuenta para blancas y para negras: el valor de las piezas, la pareja de alfiles, el centro, la seguridad del rey, los peones pasados, las piezas colgadas, las amenazas de mate, los rayos X… (la lista completa, con su número, está en `DISENO.md`). Se dividen en **baratos, medios y caros** según lo que cuesta calcularlos.

Cada detector tiene un **gen de encendido**: si es negativo, la araña no lo mira. Nadie castiga a mano los detectores caros. Como cada jugada tiene un tiempo fijo, una araña que enciende muchos detectores caros ve menos jugadas por delante, y la evolución decide sola si le compensa.

### Los tres ejes y los cinco genes por medida

Lo que vale una cosa depende del momento de la partida. Por eso cada medida lleva **5 genes**:

| Gen | Cuándo pesa |
|---|---|
| apertura | al principio |
| medio juego | con muchas piezas |
| final | con pocas piezas |
| estructura | posiciones cerradas (positivo) o abiertas (negativo) |
| temperatura | posiciones tácticas, con piezas atacadas y jaques |

La posición se coloca en tres ejes con una **mezcla suave** (sin saltos): la *fase* reparte entre apertura, medio juego y final según el material; la *estructura* va de abierta a cerrada según los peones bloqueados; la *temperatura* va de tranquila a táctica.

El peso de una medida en una posición concreta es:

```
peso = (apertura × fA + medio × fM + final × fF) + estructura × e + temperatura × t
```

y el valor de la posición es la suma de *medida × peso* de todos los detectores encendidos, más lo que añada la red que crece (ver distópica 29).

### Genes de las jugadas y de cómo piensa

- **Tipo de jugada** (6 genes): un extra para capturas, jaques, sacrificios, avances de peón, enroques y coronaciones. Sirve para ordenar las jugadas (las que más le gustan se miran primero, lo que hace la búsqueda más rápida) y como pequeño gusto en la raíz.
- **Cómo piensa** (4 genes, con límites): extender la búsqueda en jaque, profundidad de la calma (cuántas capturas sigue mirando al final), descartar ramas malas antes de tiempo y cuánto tiempo gasta en el medio juego.

## Cómo piensa una jugada

1. **Búsqueda alfa-beta** con profundización iterativa: mira a 1 jugada, luego a 2, a 3… hasta que se acaba su tiempo o su profundidad máxima. Usa tabla de transposición (claves Zobrist) y buen orden de jugadas.
2. Al final de cada línea, **quiescencia**: sigue mirando capturas para no valorar una posición a mitad de un cambio.
3. En las hojas aplica sus detectores (y los sesgos de las distópicas 31 y 32).
4. En la raíz suma su carácter (agresividad, sacrificio) y, si tiene el gen del azar, puede elegir entre jugadas casi igual de buenas.
5. La partida termina por mate, ahogado, triple repetición, regla de las 50 jugadas, material insuficiente o **abandono** (si su valoración es desastrosa durante varias jugadas seguidas). Con *Límite de jugadas* en «Sin límite», no hay más final que esos.

## Una generación: torneo suizo, final y Stockfish

Cada generación es un torneo de las 32 arañas (y, si están encendidas, de las 8 cazadoras):

1. **Rondas de sistema suizo** (4 por defecto). En la primera, las arañas se emparejan por Elo; en las siguientes, **por la clasificación**: la mesa 1 la juegan las dos primeras, la mesa 2 las dos siguientes, y así. No se repite rival si se puede evitar.
2. Cada emparejamiento es un **mini-match de ida y vuelta**: la misma apertura al azar (equilibrada), una vez con cada color. En la mesa se ve el marcador (`Ida 1-0 · Vuelta ½-½`).
3. **Clasificación** en directo: puntos del torneo y, para desempatar, **Buchholz** (la suma de los puntos de sus rivales) y luego el Elo.
4. **Final**: las dos primeras juegan ida y vuelta en la zona grande de arriba. Si empatan, una partida de desempate. La ganadora es la **campeona** y suma 1 punto extra.
5. **Cazadoras** (si está encendida la distópica 34): cada una juega 2 partidas contra la élite.
6. **Escalera de Stockfish**: las 4 mejores (ajustable) juegan contra el peldaño actual, con blancas y con negras desde la misma apertura.

### La escalera

23 peldaños de Stockfish, del más flojo (nivel 0 mirando una jugada) a Stockfish al máximo (10 segundos por jugada). Cada uno tiene su Elo aproximado (ver [El Elo](#el-elo)). Un peldaño se **conquista** cuando las arañas sacan al menos la mitad de los puntos en sus últimas 8 partidas contra él; entonces se sube al siguiente. Ganar al torneo pero perder contra Stockfish no elimina a nadie: la escalera solo suma premio, y el entrenamiento sigue.

## La puntuación

Al acabar la generación, cada araña tiene una **aptitud**:

```
aptitud = puntos del torneo + premio de Stockfish + novedad + Elo / 100 000
```

- **Puntos del torneo**: 1 por victoria, ½ por tablas, más 1 si es la campeona.
- **Premio de Stockfish**, por partida: *aguante* (hasta 0,5, cuanto más dura la partida más vale) + *calidad* (0 a 1, según cómo de mal le iba en la valoración de Stockfish) + *resultado* (**tablas 6, victoria 12**). Desde la 0.36.0 (lo pidió Juan) el resultado manda: antes eran tablas 2 y victoria 3, y aguantar valía hasta 1. Ahora unas tablas con Stockfish valen casi lo que ganar todas las partidas del torneo, y una victoria, más.
- **Novedad** (distópica 37): cuánto se diferencia su estilo de las demás.
- El **Elo** solo desempata.

## Cómo nacen las hijas: selección, cruce y mutación

**Primera generación**: el 80 % nace con valores clásicos de ajedrez más un poco de ruido; el 20 % totalmente al azar.

Después, en cada generación:

1. **Élite**: las 4 mejores pasan intactas.
2. **Selección por minitorneo**: para elegir cada padre se sacan 3 arañas al azar y gana la de mejor aptitud. Así las buenas tienen más hijas, pero las flojas no desaparecen del todo.
3. **Cruce por bloques**: la hija recibe cada bloque de genes **entero** de uno de los dos padres (un detector con sus 5 genes y su encendido, los genes de jugadas, los de cómo piensa, la red…). Del padre con mejor aptitud toma cada bloque con probabilidad 0,6. No se mezclan medio detector de uno y medio del otro, porque los genes de un mismo detector tienen sentido juntos.
4. **Mutación**: cada gen tiene una probabilidad del 6 % de cambiar. Si cambia, se le suma un ruido gaussiano de tamaño *σ × (|valor| + escala)*, para que los números grandes muevan más y los pequeños menos. Los genes de encendido no reciben ruido: con la mitad de probabilidad cambian de signo (encender o apagar). Los genes con límites (cómo piensa, carácter, azar…) se recortan a su rango. El valor de las piezas (detector 1) nunca se apaga.
5. **σ va por ciclos** (desde la 0.34.0): empieza en 0,3 y se multiplica por 0,96 en cada generación, hasta un suelo de **0,03** (antes era 0,002, y desde la generación ~123 las hijas ya casi no cambiaban). Hay una **sacudida** (σ sube al menos a 0,15) si la misma campeona gana 5 generaciones seguidas o si el Elo medio de la población (suavizado) no sube 25 puntos en 15 generaciones. Después vuelve a enfriarse, así que explora y afina por turnos. El resumen de cada generación apunta si hubo sacudida y por qué (`campeona` o `elo`).
6. **Inmigrantes**: si la diversidad de la población cae por debajo de 0,03 (todas casi iguales), entran 2 arañas nuevas al azar.
7. **Elo**: cada partida ajusta el Elo de las dos (K = 20). Las hijas empiezan con la media de sus padres. Ver [El Elo](#el-elo).

Todo queda apuntado: de cada araña se guardan sus padres, cuántos bloques dio cada uno, qué genes mutaron, con qué σ y cuánto la cambió el gradiente. Por eso la ficha puede dibujar la línea de cada gen a lo largo de su linaje.

## El Elo

Desde la 0.32.0 el Elo está en la **escala normal** (la de las listas de motores, CCRL, que es la que usa Stockfish con «Elo limitado»; para personas es orientativo). Antes solo era relativo entre las arañas y se inflaba sin parar (las hijas heredan la media de sus padres y las peores mueren), hasta salir cifras como 6600.

- **Cada peldaño tiene su Elo**, calibrado con 418 partidas entre peldaños vecinos y contra Stockfish con «Elo limitado» (1320, 1700, 2100, 2500 y 2900, a 1 s por jugada). Se ve en la Escalera:

  | Peldaño | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|
  | Elo ≈ | 1160 | 1280 | 1340 | 1500 | 1660 | 1680 | 1700 | 1800 | 1940 | 2070 | 2120 | 2220 |

  | Peldaño | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | Elo ≈ | 2280 | 2370 | 2520 | 2780 | 2810 | 3000 | 3250 | 3350 | 3450 | 3550 | 3600 |

  Del 19 al 23 son estimaciones (están por encima de la ancla más alta). Como las anclas jugaron a 1 s por jugada, más deprisa que su calibración oficial, puede que todo esté algo alto (del orden de 100).
- Una población recién nacida empieza en 1500 (los genes clásicos juegan más o menos como los peldaños 4 y 5).
- **Las arañas se anclan a la escalera**: tras cada generación, sus partidas contra Stockfish desplazan el Elo de todas a la vez (máxima verosimilitud con el modelo de Elo, y una previa para no dar saltos con pocas partidas). Entre ellas, el Elo sigue diciendo quién es mejor que quién.
- **Sin inflación**: al nacer una generación, la media se mantiene; si la población mejora de verdad, lo dicen las partidas contra Stockfish.
- **Lo guardado se recalculó** al abrir la 0.32.0: cada generación con su propio desplazamiento, sacado de sus partidas contra Stockfish (y de las vecinas). Las copias importadas de antes se pasan igual, con sus propias generaciones.
- Es una estimación: con 8 partidas por generación puede moverse ±100.

## Las distópicas

Once ideas raras para intentar ganar a Stockfish, cada una con su interruptor en Opciones (apagar una no borra sus genes):

| Nº | Nombre | Qué hace |
|---|---|---|
| 29 | Red que crece | Hasta 8 neuronas ocultas; cada una lee 4 medidas en bruto y suma *salida × tanh(…)*. Nacen apagadas; la mutación las enciende, las recablea o las apaga. |
| 30 | Personalidad | Agresividad (premia capturas y jaques), sacrificio (dejar piezas en el aire) y riesgo (no querer o aceptar tablas). |
| 31 | Anti-motor | Gusto por las posiciones cerradas, donde los motores sufren más. |
| 32 | Caos | Gusto por las posiciones tácticas y complicadas. |
| 33 | Un cerebro por fase | Apertura, medio juego y final con pesos propios. Apagada, todas usan los del medio juego. |
| 34 | Parásitos | 8 cazadoras que evolucionan aparte buscando las debilidades de la élite. Lo que la élite pierde contra ellas le resta. |
| 35 | Memoria del rival | Recuerda cómo le va contra cada rival (cazadoras, cada peldaño de Stockfish, Juan, Lichess). Si le va mal, busca más las tablas; si le va bien, arriesga más. |
| 36 | Mutación propia | Cada araña lleva el tamaño y la probabilidad de su propia mutación, que también mutan. |
| 37 | Novedad | Premia (un 15 % de los puntos posibles, ajustable) ser distinta de las 5 más parecidas, entre la población y un archivo de 150. |
| 38 | Azar | Entre jugadas a menos de *azar × 40* centipeones de la mejor, elige al azar, comprobando cada candidata con una búsqueda exacta. |
| 39 | Gradiente | Cada hija afina por descenso de gradiente los pesos de sus medidas y de su red para valorar como Stockfish (ver [El gradiente](#el-gradiente)). |

## El gradiente

Desde la 0.35.0 (distópica 39, idea de Juan). La mutación al azar busca a ciegas; el gradiente dice **hacia dónde** mover cada número. Es lo que en ajedrez se llama *Texel tuning*.

- **Por qué se puede.** La valoración es la suma de *medida × peso*, y cada peso es una mezcla lineal de los 5 genes de la medida. Así que la derivada de la valoración respecto a cada gen es la propia medida por su factor de fase, estructura o temperatura. La red que crece también se deriva (es una `tanh`). Una prueba comprueba que *medidas × pesos* da exactamente la misma valoración que el motor.
- **Posiciones.** Al cerrar cada generación se sacan posiciones **tranquilas** (sin jaque y sin capturas que ganen material) de sus partidas, también las de Stockfish: 400 por generación (ajustable). Se guardan las últimas 6000.
- **Etiquetas.** Stockfish las valora a profundidad 8 (ajustable) y esa valoración se pasa a probabilidad de ganar de las blancas. Si Stockfish no carga, se elige «Resultado de la partida» o se pausa a medias, la etiqueta es el resultado.
- **Ajuste (Lamarck).** Antes de jugar, cada hija recibe 20 pasos de **Adam** (lotes de 256 posiciones) sobre los genes de sus detectores encendidos y de su red, para que su probabilidad se parezca a la etiqueta. Una de cada 8 posiciones no se usa para ajustar: sirve para medir el error. Si el error empeora, se repite con la mitad de paso hasta 3 veces; si sigue sin mejorar, la hija se queda como nació. La élite pasa intacta.
- **Qué decide cada uno.** El gradiente afina los números; la evolución sigue decidiendo lo que no tiene derivada: qué detectores se encienden, cómo piensa, carácter, sesgos, azar y qué neuronas nacen.
- **Seis decimales.** Desde la 0.35.0 los genes se guardan con 6 decimales (antes 4).
- **Dónde se ve.** En la ficha de cada hija («gradiente: error … → …») y en la Gráfica («Gradiente: error antes y después»). Si el error baja generación a generación, las arañas valoran cada vez más como Stockfish.
- **Lo que cuesta.** Unos 0,3 s por generación para ajustar a todas las hijas, y lo que tarde Stockfish en etiquetar (en un ordenador, unos 4 ms por posición).

## La sala

- **Arriba**, en grande y en el centro: la **final** (o, mientras no la hay, la mesa 1, la de las líderes) y, a su lado, la partida contra **Stockfish**, con la escalera debajo. Debajo, la **clasificación** del torneo y el número de ronda. Luego las mesas (la 1 con las dos primeras, la 2 con las siguientes…) y el rincón de las cazadoras.
- **Zoom**: de lejos, puntos de color; de medio, mini-tableros; de cerca, tablero completo con la barra de valoración y los detectores que más pesan.
- **Tocar una araña** abre su ficha: padres, mutaciones, cada gen con su línea, estilo, distópicas, memoria y resultados.
- **Tocar una partida** abre el visor: jugadas en notación inglesa (Nf3, Bxe5, O-O), adelante y atrás (también con las flechas del teclado), girar, copiar PGN y el **análisis de Stockfish** (valoración y 2 líneas). Se pueden **mover las piezas** para probar ideas propias: se abre una variante, Stockfish la analiza, y la partida no cambia. Al coronar se elige la pieza.
- **Botones de abajo**: Biblioteca, Registro (todas las arañas que han existido, en tabla), Lichess, Escalera, Gráfica, Árbol, ADN, Estilos, Partidas e Hitos.
- **Barra de estado**: generación, ronda, partidas hechas y una barrita de progreso de la generación.
- **Atajos en el ordenador**: espacio (entrenar o pausa), + y − (zoom), 0 (ver toda la sala), B (biblioteca), L (Lichess), Esc (cerrar).
- **Opciones**: tiempo por jugada, profundidad, rondas, límite de jugadas (120, 160, 240 o sin límite), final sí o no, Stockfish, distópicas, novedad…
- **Varias evoluciones** (botón ▤): empezar otra desde cero o duplicar la actual sin perder ninguna.

## Jugar fuera: Lichess y motor para el ordenador

### Lichess (con internet)

En la Biblioteca, «**Que juegue en Lichess**», o el botón *Lichess*:

1. Crear en Lichess **una cuenta nueva solo para la araña**, sin jugar ninguna partida con ella.
2. Con esa cuenta, crear un token con el permiso *Play games with the bot API* (el enlace está en la propia pantalla) y pegarlo. **El token se guarda solo en el aparato**, nunca en el repositorio.
3. Pulsar «Convertir en BOT» (no tiene vuelta atrás; por eso, cuenta nueva) y «Conectar».

La araña acepta retos de ajedrez normal con reloj (hasta 2 partidas a la vez) y rechaza los demás explicando por qué; también puede **retar** a un usuario (por ejemplo a los bots `maia1`, `maia5`, `maia9`). Piensa en un hilo aparte, reparte su tiempo según el reloj, saluda en el chat y apunta los resultados en su memoria del rival. Mientras está conectada, la app intenta seguir viva en segundo plano.

**chess.com no admite bots**: jugar allí con un motor es motivo de cierre de la cuenta, así que no se ofrece.

### Motor para el ordenador (sin internet)

«**Exportar como motor para el ordenador (UCI)**» crea un archivo `.js` con el motor y los genes de esa araña. Funciona sin internet con [Node.js](https://nodejs.org):

```
node arana-nombre.js
```

Habla el protocolo **UCI**, así que sirve en cualquier programa de ajedrez (Cute Chess, Arena, BanksiaGUI…: añadir un motor con el comando `node` y el archivo como argumento) y en `lichess-bot`. Entiende `uci`, `isready`, `ucinewgame`, `position startpos|fen … moves …`, `go wtime/btime/winc/binc/movetime/depth` y `quit`.

## Rendimiento: niveles

En Opciones, **Cuánto trabaja el aparato**. El nivel lo elige usted y **no cambia solo** (desde la 0.33.0, a petición de Juan):

| Nivel | Hilos | Descanso entre partidas | Nodos por jugada (tiempo automático) |
|---|---|---|---|
| Ahorro | 1 | tanto como dura la partida | 2500 |
| Equilibrado (por defecto en móvil) | la mitad de los núcleos | un 20 % | 4000 |
| Máximo (por defecto en Linux) | todos menos uno (hasta 8; en Linux, sin tope) | ninguno | 6000 |

- **Mide el aparato**: cada hilo, cada 4 partidas, repite la misma búsqueda de prueba y mide los nodos por milisegundo. Solo sirve para el tiempo automático y para enseñar la velocidad; no baja el ritmo.
- **Tiempo por jugada «Automático»** (por defecto): sale de esa velocidad, para que la araña piense más o menos los mismos nodos en un aparato lento que en uno rápido. También se puede fijar a mano, de 10 ms a 5 s.
- **Profundidad máxima**: de 2 a 20 jugadas, o «sin tope» (manda el tiempo). Contra Stockfish la araña piensa lo mismo que en el torneo.

## Linux sin pantalla (servidor)

El servidor (`servidor/`) deja a la araña entrenando las 24 horas en un ordenador con Linux sin entorno gráfico (Arch, con systemd). Desde el móvil, por Tailscale, se ve y se maneja la sala en directo. Cómo instalarlo y usarlo: [`servidor/LEEME.md`](../servidor/LEEME.md).

## La red en la gráfica (en construcción)

Juan quiere que en el Arch entrene la **RTX 5080**. La búsqueda alfa-beta y los 45 detectores no ganan nada en una gráfica, así que será una distópica nueva (la 40): una red neuronal que lee el tablero entero (12 planos de 8×8, bloques residuales, valoración y política, como Leela), valora por lotes en la gráfica con una búsqueda MCTS, aprende por gradiente de lo que etiqueta Stockfish y deja a la evolución el tamaño de la red, cómo busca y cómo aprende.

| Fase | Qué | Estado |
|---|---|---|
| 1 | WebGPU en el Chromium del servidor, convolución 3×3 y capa densa en la gráfica, comparadas con el procesador, y medida de velocidad (`gpu.js`, `gpu.html`, `servidor/probar-gpu.js`). llama-server lo para Juan a mano. En la RTX 5080 de Juan funciona con la forma «nativo» (Vulkan sin caja de arena y sin la lista de bloqueo de Dawn): mismos resultados que el procesador (diferencia 1,6·10⁻⁶) y **53.002 posiciones/s** con la red de prueba (4,8 ms por lote de 256, unos 3 TFLOP/s, sin optimizar). | hecha (0.37.0) |
| 2 | La red y su entrenamiento en la gráfica, con las posiciones que etiqueta Stockfish (`red.js`; la sala la entrena al cerrar cada generación). En la 5080: 36 ms por paso de 256 posiciones; con 20.000 posiciones de prueba acierta la jugada objetivo el 53 % y el error del valor baja de 0,117 a 0,096 (solo el valor: 0,071). Elegido con un barrido: cabeza «plano», ritmo 0,001, política con peso 0,1, ReLU con fuga y entropía cruzada para el valor. | hecha (0.38.0) |
| 3 | Búsqueda MCTS por lotes (`mcts.js`, PUCT con pérdida virtual, lotes de 64 en la gráfica, finales exactos). Tras entrenar, la red juega ida y vuelta contra su propio peldaño de Stockfish (sube con 1,5 de 2, baja con 0) y contra la primera del torneo; su Elo sale de sus últimas 40 partidas. Se ven en *Partidas → La red en la gráfica* y en la Gráfica («Elo jugando»). Opciones: simulaciones por jugada (400) y si juega. Aún no entra en la evolución. | hecha (0.39.0) |
| 4 | Evolución del tamaño de la red, la búsqueda y el aprendizaje | pendiente |

## Sin internet y en segundo plano

- **Sin internet**: el *service worker* (`../sw.js`) guarda la sala, el motor, las piezas y Stockfish la primera vez que se abre. Después funciona todo sin conexión menos Lichess. En la app de iPhone, la vista web lo permite gracias a `WKAppBoundDomains`.
- **Segundo plano**:
  - *iPhone (app nativa)*: mientras entrena suena un audio en silencio (modo de fondo `audio`, mezclado con otros sonidos), así iOS no la congela. Avisos locales con el progreso al acabar cada generación y con cada hito.
  - *Android*: un servicio en primer plano con notificación («Entrenando…») y un bloqueo parcial del procesador; la notificación se actualiza con el progreso.
  - *Ordenador*: el navegador frena las pestañas ocultas pero sigue; si se da permiso, avisa con notificaciones.
  - Con el aparato en reposo va más lento (el sistema da menos procesador), pero sigue.

## Dónde se guarda todo

- **IndexedDB** del aparato, aparte de la memoria del asistente: `arana-ajedrez` (la primera evolución) y `arana-ajedrez-<id>` (las demás). Dentro: estado, individuos (con genes, padres, mutaciones, historia), generaciones (resúmenes, ADN, torneo), partidas de cada generación y el registro de todas las arañas que han existido.
- **localStorage**: `arana.ajedrez.opc` (opciones), `arana.ajedrez.slots` y `arana.ajedrez.slot` (evoluciones) y `arana.ajedrez.lichess` (token y araña elegida).
- **Copias**: «Exportar» guarda un archivo con toda la evolución o con una araña; se importa en otro aparato desde la Biblioteca.
- Se guarda al terminar cada generación. Nunca se borran datos al actualizar.

## Archivos y pruebas

| Archivo | Qué es |
|---|---|
| `motor.js` | Reglas, detectores, búsqueda, partidas, evolución, SAN y PGN. Funciona en el navegador, en los hilos y en Node. |
| `worker.js` | Un hilo: juega partidas o piensa una jugada. |
| `sala.js` | La sala: torneo, Stockfish, vistas, fichas, visor, biblioteca, Lichess, exportar. |
| `index.html` | La página de la sala y sus estilos. |
| `gpu.js`, `gpu.html` | La gráfica (WebGPU): convolución y capa densa, y la página de prueba. |
| `red.js`, `mcts.js` | La red en la gráfica (distópica 40) y su búsqueda MCTS. |
| `piezas.js` | Piezas cburnett (GPLv2+, ver `PIEZAS.md`). |
| `stockfish/` | Stockfish 19 lite de un hilo (GPL v3, ver `stockfish/LEEME.md`). |
| `DISENO.md` | Las decisiones de diseño y el estado de cada fase. |

Pruebas (desde la raíz del repositorio):

```
node ajedrez/pruebas/reglas.js        # perft y simetría blancas/negras
node ajedrez/pruebas/evolucion.js 1   # una generación completa
node ajedrez/pruebas/stockfish.js     # Stockfish responde y se juega una partida
node ajedrez/pruebas/gradiente.js     # distópica 39: valoración exacta, etiquetas y el error baja
node ajedrez/pruebas/mcts.js          # distópica 40: la búsqueda encuentra mates, gana material y juega legal
```
