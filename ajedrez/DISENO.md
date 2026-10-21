# Araña juega al ajedrez — diseño

Decidido con Juan el 2026-10-21. La araña es la jugadora; lo que evoluciona es su «cerebro de ajedrez» (red neuronal + algoritmo genético). Objetivo: subir una escalera contra Stockfish cada vez más fuerte.

## Infraestructura
- Dentro de Araña, en una pantalla propia (la **sala de partidas**), en todas las versiones (web, Android, iPhone).
- **Un solo cerebro** en JavaScript (`ajedrez/motor.js`), igual en todas; las apps nativas lo muestran en una vista web.
- Entrena **en el propio aparato** y solo con la app abierta y la pantalla encendida. Partidas en paralelo con *Web Workers*.
- Guarda **al terminar cada generación** en IndexedDB (memoria aparte de la del asistente): individuos con generación, padres, mutaciones, puntuación, Elo, origen y genes; élite de cada generación; la mejor partida.
- Copia: exportar a fichero (Drive) y, opcional, subida a GitHub con token.
- Reglas del ajedrez con un generador de jugadas propio (sin dependencias), comprobado con *perft*.

## Biblioteca de arañas
Cada aparato evoluciona su propia araña. Se pueden importar las de otros y, eligiendo un individuo o generación: **jugar contra ella**, **rival** (duelo o torneo), **mezclar** en la población o **retomar** desde ese punto. Cada individuo guarda su origen («sangre» de iPhone, Android, web o parásitos).

## La red
- **45 detectores de posición** (numerados hasta el 61 porque la lista incluye también la fase, 22; los genes de cómo piensa, 24–28; y las distópicas, 29–38). Cada detector lleva **gen de encendido**. Los caros no se castigan a mano: como cada jugada tiene un tiempo fijo, encenderlos hace pensar menos jugadas por delante y la evolución lo nota sola.
  - Baratos: valor de piezas (1), pareja de alfiles (2), desequilibrios (3), tablas de casillas con simetría (4), centro (5), enroque (11), peones débiles (12), pasados con regla del cuadrado (13), conectados (39), mayoría en un flanco (40), simplificar ganando (41), alfiles de distinto color (42), material insuficiente (43), tempo (44), buscar tablas (45).
  - Medios: movilidad segura (6), espacio (7), escudo del rey (8), atacantes del rey, no lineal (9), columnas hacia el rey (10), islas y cadenas (14), torres (15), puestos avanzados (16), alfil malo (17), agujeros (46), rey activo en finales (47), cercanía al rey rival (48), coordinación (49), diagonales largas (50), baterías (51), dama temprana (52), rupturas (53), bloqueo de pasados (54), avalancha (55).
  - Caros: colgadas o atrapadas (18), golpes tácticos (19), cambios en una casilla (20), jaques seguros (21), desarrollo e iniciativa (23), amenaza de mate (56), huidas del rey (57), sobrecarga (58), rayos X (59), piezas sueltas (60), carreras de peones (61).
- **Tres ejes** con mezcla suave: fase (apertura, medio juego, final), estructura (abierta–cerrada) y temperatura (tranquila–táctica; sale de las piezas atacadas y los jaques).
- **Pesos sumados**: peso = cerebro de la fase (mezcla de apertura, medio juego y final) + ajuste de estructura + ajuste de temperatura. 5 genes por medida, más el de encendido de cada detector.
- **Valor de la posición** y **extra por tipo de jugada** (captura, jaque, sacrificio, avance de peón, enroque, coronación), con sus genes.
- Búsqueda alfa-beta con quiescencia; profundidad y tiempo ajustables. Genes de cómo piensa: extender en jaque (24), profundidad de la calma (25), descartar ramas (27) y tiempo en el medio juego (28); el orden de las jugadas (26) usa los genes de cada tipo de jugada.
- En la fase 1 la «red» es de una capa: cada medida por sus pesos. Las capas ocultas que crecen solas llegan con la distópica 29 (fase 4).

## Evolución
- 32 arañas. Nacen 80 % con valores clásicos + ruido y 20 % al azar.
- Autojuego: unas 8 partidas por araña, blancas y negras, desde aperturas al azar equilibradas; Elo propio.
- Puntuación: puntos del torneo + escalera de Stockfish para las 4 mejores (cuánto aguantan, cómo de mal van según Stockfish, subir de nivel; las tablas valen mucho). Detalle en «Estado», fase 3.
- Élite de 4 intactas; padres por minitorneo de 3; cruce por bloques (cada detector entero de un padre).
- Mutación pequeña que se afina con más decimales; vuelve a crecer si se estanca. Inmigrantes si todas se parecen.
- **Distópicas, todas, cada una con su interruptor**: red que crece sola (29), personalidad (30), anti-motor (31), caos (32), varios cerebros por fase en lugar del ajuste de fase (33), parásitos (34, unas 8 cazadoras), memoria del rival (35), mutación propia (36), novedad (37, 15 % de la puntuación, ajustable), azar (38).

## Lo visual
- **Sala de partidas**: plano con zoom y desplazamiento; 16 mesas con las 32 arañas, zona Stockfish al fondo y rincón de parásitos. Se abre **vista entera desde lejos**.
  - Lejos: mesas como puntos de color. Medio: mini-tableros, nombre y Elo. Cerca: tablero completo, araña moviendo piezas, barra de evaluación (suya frente a Stockfish) y detectores que se iluminan.
- **Ficha al tocar una araña**: su generación (padres, mutaciones, origen), cada gen con minigráfica de su evolución en el linaje, detectores encendidos, radar de personalidad, Elo y mejor resultado contra Stockfish.
- **Botones auxiliares**: gráfica por generación, escalera, árbol genealógico en telaraña, ADN (mapa de calor), mapa de estilos, repeticiones, hitos (hacen crecer la telaraña de Araña), biblioteca y opciones de entrenamiento.
- Opciones: tiempo por partida, vista en directo o resumen, población, mutación, interruptores.
- Solo se dibuja con detalle lo que se mira de cerca.

## Activación
«Vamos a jugar al ajedrez», «ajedrez», «entrena»… se reconoce en local, sin gastar consultas. La araña camina al borde y aparece la sala. Un botón para regresar.

## Fases
1. Cerebro, detectores y autojuego.
2. Sala visual y fichas.
3. Stockfish y la escalera.
4. Distópicas.
5. Biblioteca, exportar e importar; Android e iPhone.

## Estado
- **Fase 1, hecha (0.24.0, 2026-10-21):** reglas propias comprobadas con perft en 5 posiciones de referencia; los 45 detectores, con prueba de simetría blancas/negras; tres ejes; búsqueda; autojuego en hilos; evolución completa (élite, minitorneos, cruce por bloques, mutación que se afina, sacudida si se estanca, inmigrantes); sala con 16 mesas en directo o en resumen; ficha de cada araña; opciones; exportar copia; pantalla encendida mientras entrena; guardado por generación.
- **Fase 2, hecha (0.25.0, 2026-10-21):** plano con desplazamiento y pellizco; tres niveles (lejos: puntos de color; medio: mini-tableros; cerca: tablero con las dos arañas y su hilo, barra de evaluación y detectores que más pesan). Zona de Stockfish y rincón de cazadoras reservados. Ficha con linaje (por el padre que dio más bloques), cada gen con su línea por generación y radar de estilo. Vistas: gráfica, árbol en telaraña (últimas 5 generaciones), ADN, mapa de estilos, la mejor partida de cada generación e hitos (cada uno hace crecer la telaraña de Araña). Se guarda la huella de genes de todas las arañas; base de datos v2 con índice por generación.
- El radar de estilo de la fase 2 sale de los pesos de los detectores; los genes de personalidad propiamente dichos (30) llegan en la fase 4.
- **Fase 3, hecha (0.26.0, 2026-10-21):** Stockfish 19 lite de un hilo (`ajedrez/stockfish/`, 1,8 MB, GPL v3, en el propio aparato). Escalera de 12 peldaños (nivel de Stockfish y profundidad o tiempo), calibrada: la araña clásica gana los peldaños 1 y 2 y compite del 3 al 5. Tras cada torneo, las 4 mejores (ajustable) juegan con blancas y con negras desde la misma apertura. Premio por partida = aguante (hasta 1) + calidad según Stockfish (0–1) + resultado (tablas 2, victoria 3), sumado a los puntos del torneo. Un peldaño se conquista con la mitad de los puntos en sus últimas 8 partidas. La partida se ve en directo en la zona de Stockfish (la araña frente a un pez), con la valoración de los dos. Si Stockfish no carga, la evolución sigue sin escalera.
- **Fase 4, hecha (0.27.0, 2026-10-21):** las diez distópicas, encendidas al empezar y con interruptor en Opciones; apagar una no borra sus genes.
  - 29 Red que crece: hasta 8 neuronas ocultas; cada una lee 4 medidas en bruto (81 posibles, todas menos las tablas de casillas) y suma salida × tanh. Nacen apagadas y la mutación las enciende, recablea o apaga.
  - 30 Personalidad: agresividad (premia capturas y jaques en la raíz), sacrificio (premia dejar piezas en el aire) y riesgo (arriesgada: no quiere tablas; prudente: las acepta).
  - 31 Anti-motor y 32 Caos: sesgos en las hojas de la búsqueda hacia posiciones cerradas o tácticas, desde el bando que piensa.
  - 33 Un cerebro por fase: los pesos de apertura, medio juego y final de cada medida; apagado, todas las fases usan el del medio juego.
  - 34 Parásitos: 8 cazadoras que evolucionan aparte; cada una juega 2 partidas contra la élite; lo que la élite pierde le resta en su generación.
  - 35 Memoria del rival: resultados contra las cazadoras y contra cada peldaño de Stockfish; con 2 partidas o más, si saca menos del 30 % busca más las tablas y arriesga menos, si saca más del 60 % al revés. Se hereda del padre que más dio.
  - 36 Mutación propia: tamaño y probabilidad de mutación de cada araña, que también mutan.
  - 37 Novedad: descriptor = estilo + duración de sus partidas; novedad = distancia media a las 5 más parecidas (población y archivo de 150); pesa un 15 % (ajustable) de los puntos posibles del torneo.
  - 38 Azar: entre jugadas a menos de azar × 40 centipeones de la mejor, cada candidata comprobada con una búsqueda exacta.
  - Calibración: con todas encendidas la población inicial saca 9,5 de 16 contra el peldaño 1, igual que con todas apagadas (10 de 16).
- Pendiente: fase 5. En la app nativa de iPhone la sala llega en la fase 5; en Android ya funciona porque carga la web.
