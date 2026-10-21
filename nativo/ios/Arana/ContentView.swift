import SwiftUI

/// Una opción bajo la araña (como las de la web): la principal en azul.
struct Opcion: Identifiable {
    let id = UUID()
    let texto: String
    var principal = false
    let accion: () -> Void
}

struct ContentView: View {
    @State private var input = ""
    @State private var bubble = "Buenas. Soy su araña, ya fuera de la web."
    @State private var thinking = false
    @State private var showSettings = false
    // 0.28.0: la sala de ajedrez (la araña juega y su cerebro evoluciona)
    @State private var showAjedrez = false
    @State private var entrenarAjedrez = false
    @State private var key = Keychain.load()
    @State private var ghToken = Keychain.load(account: Peticiones.cuenta)
    @StateObject private var ear = Listener()
    @ObservedObject private var metro = Metronomo.shared
    @AppStorage("arana.hilos") private var hilos = 0
    // 0.23.0: la araña vuelve a moverse, a preguntar y a pedirle a Claude lo que no sabe
    @AppStorage("arana.pasear") private var pasear = true
    @AppStorage("arana.preguntar") private var preguntar = true
    @State private var off: CGSize = .zero
    @State private var dragStart: CGSize?
    @State private var heading: Double = -Double.pi / 2
    @State private var walking = false
    @State private var hopping = false
    @State private var moving = false
    @State private var escondida = false
    @State private var area: CGSize = .zero
    @State private var opciones: [Opcion] = []
    @State private var idleSince = Date()
    @State private var lastQuestion = Date()
    @State private var esperandoDeseo = false
    @FocusState private var typing: Bool
    @Environment(\.openURL) private var openURL

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Wallpaper().ignoresSafeArea()
                Telarana(threads: hilos).ignoresSafeArea().allowsHitTesting(false)
                VStack(spacing: typing ? 8 : 18) {
                    HStack(spacing: 18) { Spacer()
                        Button { abrirAjedrez(entrenar: false) } label: { Image(systemName: "checkerboard.rectangle").font(.title2) }.accessibilityLabel("Ajedrez")
                        Button { showSettings = true } label: { Image(systemName: "gearshape").font(.title2) } }
                        .foregroundStyle(.white.opacity(0.8)).padding(.horizontal)
                    Spacer(minLength: 0)
                    // Con el teclado abierto el bocadillo se encoge y se puede desplazar: así no se corta nada.
                    ViewThatFits(in: .vertical) {
                        bubbleView
                        ScrollView { bubbleView }
                    }
                    .frame(maxHeight: typing ? 120 : 300)
                    spider
                    if thinking { Text("Pensando…").font(.caption.bold()).foregroundStyle(.white.opacity(0.8)) }
                    if ear.listening {
                        Text(ear.heard.isEmpty ? "Escuchando…" : ear.heard)
                            .font(.callout).foregroundStyle(.white.opacity(0.85)).padding(.horizontal)
                    }
                    if !opciones.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(opciones) { o in
                                    Button(o.texto) { let a = o.accion; opciones = []; idleSince = Date(); a() }
                                        .buttonStyle(.bordered).tint(o.principal ? Color.blue : SpiderView.green)
                                }
                            }.padding(.horizontal)
                        }.fixedSize(horizontal: false, vertical: true)
                    }
                    if metro.bpm > 0 && !typing {
                        Button { metro.stop() } label: { Label("♩ \(metro.bpm) · Parar", systemImage: "metronome") }
                            .buttonStyle(.bordered).tint(SpiderView.green)
                    }
                    Spacer(minLength: 0)
                    HStack {
                        Button(action: toggleEar) {
                            Image(systemName: ear.listening ? "stop.circle.fill" : "mic.circle.fill").font(.system(size: 34))
                        }
                        .foregroundStyle(ear.listening ? Color.red : Color.white)
                        .disabled(thinking)
                        .accessibilityLabel(ear.listening ? "Dejar de escuchar" : "Hablar")
                        TextField(esperandoDeseo ? "Lo que quiere que aprenda" : "Dígame qué hacer", text: $input)
                            .textFieldStyle(.roundedBorder).submitLabel(.go).onSubmit(send)
                            .focused($typing)
                        Button("Ir", action: send).buttonStyle(.borderedProminent).disabled(thinking)
                    }.padding(.horizontal).padding(.vertical, typing ? 8 : 16)
                }
            }
            .onAppear { area = geo.size }
            .onChange(of: geo.size) { _, s in area = s }
        }
        .animation(.easeInOut(duration: 0.2), value: typing)
        .sheet(isPresented: $showSettings) { settings }
        .fullScreenCover(isPresented: $showAjedrez) {
            SalaAjedrez(entrenar: entrenarAjedrez,
                        cerrar: { showAjedrez = false; bubble = "He vuelto de la sala. Mis arañas me esperan allí." },
                        hito: { t in Memory.addThread(); hilos = UserDefaults.standard.integer(forKey: "arana.hilos"); bubble = "Hito de ajedrez: \(t)." })
        }
        .task { await vida() }
        .onChange(of: typing) { _, t in if t { idleSince = Date(); if escondida || off != .zero { off = .zero; escondida = false } } }
        .onOpenURL { u in
            // h8: el widget abre la app escuchando (arana://escuchar).
            if u.host == "escuchar", !ear.listening, !thinking { toggleEar() }
        }
        .onReceive(NotificationCenter.default.publisher(for: Escuchar.aviso)) { _ in
            // h8: el control del Centro de control abre la app escuchando.
            if Escuchar.pendiente(), !ear.listening, !thinking { toggleEar() }
        }
        .onAppear {
            if Escuchar.pendiente(), !ear.listening, !thinking { toggleEar() }
        }
        .onChange(of: ear.done) { _, said in
            guard let said else { return }
            ear.done = nil; input = said; send()
        }
    }

    private var bubbleView: some View {
        Text(bubble)
            .font(.system(.callout, design: .monospaced).weight(.medium))
            .multilineTextAlignment(.center)
            .padding(typing ? 10 : 14)
            .background(Color(red: 0.04, green: 0.05, blue: 0.09).opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(SpiderView.pink, lineWidth: 1))
            .foregroundStyle(.white).padding(.horizontal)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// La araña: un toque le escucha, dos saltan, tres bailan; mantener pulsada abre su menú y se puede arrastrar.
    private var spider: some View {
        let size: CGFloat = typing ? 120 : 240
        return SpiderView(thinking: thinking || ear.listening, heading: heading, walking: walking)
            .frame(width: 240, height: 240)
            .scaleEffect((typing ? 0.5 : 1) * (hopping ? 1.12 : 1))
            .frame(width: size, height: size)
            .contentShape(Circle().scale(0.5))
            .onTapGesture(count: 3) { Task { await mover(.dance) } }
            .onTapGesture(count: 2) { Task { await mover(.jump) } }
            .onTapGesture { tocar() }
            .simultaneousGesture(DragGesture(minimumDistance: 10)
                .onChanged { g in
                    if dragStart == nil { dragStart = off }
                    let s = dragStart ?? .zero
                    off = CGSize(width: s.width + g.translation.width, height: s.height + g.translation.height)
                    escondida = false; idleSince = Date()
                }
                .onEnded { _ in dragStart = nil; idleSince = Date() })
            .contextMenu {
                Button { Task { await mover(.dance) } } label: { Label("Bailar", systemImage: "music.note") }
                Button { Task { await mover(.walk) } } label: { Label("Dar un paseo", systemImage: "figure.walk") }
                Button { preguntarAlgo(forzar: true) } label: { Label("Pregúnteme algo", systemImage: "questionmark.bubble") }
                Button { Task { await mover(.hide) } } label: { Label("Esconderse", systemImage: "eye.slash") }
                Button { showSettings = true } label: { Label("Ajustes", systemImage: "gearshape") }
            }
            .offset(typing ? .zero : CGSize(width: off.width, height: off.height + (hopping ? -14 : 0)))
            .zIndex(2)
            .accessibilityLabel("La araña")
            .accessibilityHint("Toque para hablar. Tres toques, baila. Mantenga pulsado para su menú.")
    }

    private var settings: some View {
        NavigationStack {
            Form {
                Section("Cerebro (Claude)") {
                    SecureField("Clave de API (sk-ant-…)", text: $key)
                    Button("Guardar clave") { Keychain.save(key.trimmingCharacters(in: .whitespacesAndNewlines)); showSettings = false; bubble = "Clave guardada. Ya puedo pensar." }
                }
                Section { Text("La clave se guarda solo en el llavero de este iPhone.").font(.footnote) }
                Section("Claude, mi profesor") {
                    SecureField("Token de GitHub (github_pat_…)", text: $ghToken)
                    Button("Guardar token") {
                        Keychain.save(ghToken.trimmingCharacters(in: .whitespacesAndNewlines), account: Peticiones.cuenta)
                        showSettings = false; bubble = "Token guardado. Lo que no sepa, se lo pido yo misma a Claude."
                    }
                    Text("Con token, lo que no sé hacer se lo pido a Claude yo sola. Créelo en github.com → Settings → Developer settings → Fine-grained tokens, solo para «arana», con permiso Issues: Read and write. Sin token, le abro GitHub y usted pulsa «Create».").font(.footnote)
                }
                Section("Ajedrez") {
                    Button("Abrir la sala de partidas") {
                        showSettings = false
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { abrirAjedrez(entrenar: false) }
                    }
                    Text("Mis arañas juegan al ajedrez y su cerebro evoluciona. También se abre diciendo «vamos a jugar al ajedrez». Entrenar necesita la pantalla encendida; mientras la sala está abierta, la mantengo yo.").font(.footnote)
                }
                Section("Cómo me porto") {
                    Toggle("Pasear por la pantalla cuando no hago nada", isOn: $pasear)
                    Toggle("Hacerle preguntas de vez en cuando", isOn: $preguntar)
                    Text("Tóqueme para hablar. Dos toques: salto. Tres: bailo. Mantenga pulsado: mi menú. Arrástreme para cambiarme de sitio.").font(.footnote)
                }
                Section("Lo que sé de usted") {
                    if Memory.facts.isEmpty { Text("Aún nada. Cuénteme algo de usted y lo recordaré.").font(.footnote) }
                    ForEach(Memory.facts, id: \.self) { Text($0).font(.footnote) }
                }
            }.navigationTitle("Ajustes")
        }
    }

    // MARK: - Órdenes

    private func send() {
        let t = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !thinking else { return }
        input = ""; idleSince = Date(); opciones = []
        // Lo que me dijo cuando le pregunté qué quiere que aprenda: va directo a Claude
        if esperandoDeseo {
            esperandoDeseo = false; typing = false
            ofrecerClaude(t, "Juan quiere que lo aprenda (se lo preguntó la araña).")
            return
        }
        let n = Self.normal(t)
        if let a = SalaAjedrez.orden(n) { typing = false; abrirAjedrez(entrenar: a); return }
        if let m = Movimiento.desde(n) { typing = false; Task { await mover(m) }; return }
        if ["preguntame algo", "hazme una pregunta", "hazme preguntas", "preguntame"].contains(n) { typing = false; preguntarAlgo(forzar: true); return }
        thinking = true
        Task {
            let text = await Brain.ask(t)
            bubble = text; Voice.shared.say(text)
            hilos = UserDefaults.standard.integer(forKey: "arana.hilos")
            thinking = false
            let movs = Brain.movimientos; Brain.movimientos = []
            for m in movs.compactMap(Movimiento.init(rawValue:)) { await mover(m, callada: true) }
            if let d = Brain.deseo { Brain.deseo = nil; ofrecerClaude(d.frase, d.motivo) }
        }
    }

    private func abrirAjedrez(entrenar: Bool) {
        let t = ["Voy a la sala de partidas.", "A mi mesa de ajedrez.", "Me siento a jugar."].randomElement()!
        bubble = t; Voice.shared.say(t)
        entrenarAjedrez = entrenar
        showAjedrez = true
    }

    static func normal(_ t: String) -> String {
        t.lowercased().folding(options: .diacriticInsensitive, locale: Locale(identifier: "es_ES"))
            .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
    }

    private func toggleEar() {
        idleSince = Date()
        if ear.listening { ear.stop(); return }
        Task { if let msg = await ear.start() { bubble = msg } }
    }

    private func tocar() {
        idleSince = Date()
        if escondida { escondida = false; Task { await caminar(a: .zero) }; bubble = "¿Sí?" }
        toggleEar()
    }

    /// Lo que no sé hacer, a Claude: con token lo pido yo; sin token, le abro GitHub.
    private func ofrecerClaude(_ frase: String, _ motivo: String) {
        if Peticiones.yaPedida(frase) { bubble = "Esto ya se lo pedí a Claude. Está en ello."; return }
        if !Peticiones.token.isEmpty {
            Task { let r = await Peticiones.pedir(frase, motivo); bubble = r; await saltito() }
            return
        }
        opciones = [
            Opcion(texto: "Pedírselo a Claude", principal: true) {
                if let u = Peticiones.url(frase, motivo) { openURL(u) }
                bubble = "Pulse «Create» en GitHub y Claude se pondrá con ello."
            },
            Opcion(texto: "No") { bubble = "Como prefiera." }
        ]
    }

    // MARK: - Preguntas

    private func preguntarAlgo(forzar: Bool = false) {
        lastQuestion = Date(); idleSince = Date()
        if Double.random(in: 0...1) < 0.18 {
            bubble = "¿Qué le gustaría que aprendiera a hacer?"
            opciones = [
                Opcion(texto: "Se lo digo", principal: true) { esperandoDeseo = true; bubble = "Escríbalo. Se lo paso a Claude."; typing = true },
                Opcion(texto: "Ahora no") { bubble = "Quedo a la espera." }
            ]
            return
        }
        guard let p = Preguntas.siguiente() else {
            if !Keychain.load().isEmpty, !thinking {
                thinking = true
                Task {
                    let t = await Brain.ask("hazme una sola pregunta corta y original para conocerme mejor; cuando te conteste, recuérdalo")
                    bubble = t; Voice.shared.say(t); thinking = false
                }
            } else if forzar { bubble = "Ya sé mucho de usted. Cuénteme algo nuevo cuando quiera." }
            return
        }
        bubble = p.texto
        Voice.shared.say(p.texto)
        Task { await saltito() }
        opciones = p.opciones.map { o in
            Opcion(texto: o) {
                Preguntas.guardar(p, o)
                bubble = ["Anotado. Ya le conozco un poco más.", "Lo guardo con hilo fino.", "Interesante. Lo recordaré."].randomElement()!
                Task { await saltito() }
            }
        } + [Opcion(texto: "Prefiero no decirlo") { Preguntas.guardar(p, "prefiere no decirlo"); bubble = "Como prefiera." }]
    }

    // MARK: - Moverse

    /// Vida propia: cuando no hace nada pasea, a veces pregunta y, si se aburre, se esconde en el borde.
    private func vida() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            let idle = Date().timeIntervalSince(idleSince)
            guard !thinking, !ear.listening, !typing, opciones.isEmpty, !moving, !showSettings, dragStart == nil else { continue }
            if preguntar && idle > 30 && Date().timeIntervalSince(lastQuestion) > 75 { preguntarAlgo(); continue }
            guard pasear, idle > 4, area.width > 200 else { continue }
            if idle > 60 { if !escondida { await mover(.hide, callada: true) }; continue }
            if escondida { continue }
            if Double.random(in: 0...1) < 0.55 { await caminar(a: puntoAlAzar()) } else { await caminar(a: .zero) }
        }
    }

    private func puntoAlAzar() -> CGSize {
        let w = max(10, area.width / 2 - 70), h = area.height
        return CGSize(width: .random(in: -w...w), height: .random(in: (-h * 0.25)...(h * 0.12)))
    }

    private func caminar(a destino: CGSize, duracion: Double? = nil) async {
        let dx = destino.width - off.width, dy = destino.height - off.height
        let d = (dx * dx + dy * dy).squareRoot()
        guard d > 2 else { return }
        heading = atan2(dy, dx); walking = true
        let t = duracion ?? min(3.0, max(0.3, d / 120))
        withAnimation(.easeInOut(duration: t)) { off = destino }
        try? await Task.sleep(nanoseconds: UInt64(t * 1_000_000_000))
        walking = false
    }

    private func saltito() async {
        withAnimation(.spring(response: 0.22, dampingFraction: 0.45)) { hopping = true }
        try? await Task.sleep(nanoseconds: 220_000_000)
        withAnimation(.spring(response: 0.25, dampingFraction: 0.6)) { hopping = false }
        try? await Task.sleep(nanoseconds: 180_000_000)
    }

    private func mover(_ m: Movimiento, callada: Bool = false) async {
        guard !moving else { return }
        moving = true; idleSince = Date()
        defer { moving = false; idleSince = Date() }
        if !callada { bubble = m.frase; Voice.shared.say(m.frase) }
        if m != .hide { escondida = false }
        switch m {
        case .dance:
            let base = off
            for i in 0..<8 {
                let dx: CGFloat = i % 2 == 0 ? 34 : -34, dy: CGFloat = i % 3 == 0 ? -16 : 0
                await caminar(a: CGSize(width: base.width + dx, height: base.height + dy), duracion: 0.2)
                if i % 2 == 0 { await saltito() }
            }
            await caminar(a: base, duracion: 0.25)
            await saltito()
        case .walk:
            for _ in 0..<4 { await caminar(a: puntoAlAzar()); try? await Task.sleep(nanoseconds: 300_000_000) }
            await caminar(a: .zero)
        case .spin:
            let r = min(110, area.width * 0.28)
            for i in 0...12 {
                let a = Double(i) / 12 * 2 * .pi
                await caminar(a: CGSize(width: cos(a) * r, height: sin(a) * r * 0.8), duracion: 0.22)
            }
            await caminar(a: .zero)
            Memory.addThread(); hilos = UserDefaults.standard.integer(forKey: "arana.hilos")
        case .jump:
            for _ in 0..<3 { await saltito() }
        case .come:
            await caminar(a: .zero); await saltito()
        case .hide:
            let x = off.width < 0 ? -(area.width / 2 - 14) : (area.width / 2 - 14)
            await caminar(a: CGSize(width: x, height: off.height))
            escondida = true
        case .bow:
            await saltito()
        }
    }
}

/// Sorpresa: la telaraña de fondo. Cada orden cumplida le añade una vuelta (hasta 14).
struct Telarana: View {
    var threads: Int
    var body: some View {
        Canvas { ctx, size in
            let c = CGPoint(x: size.width / 2, y: size.height * 0.45)
            let r = max(size.width, size.height) * 0.6
            let ink = GraphicsContext.Shading.color(.white.opacity(0.07))
            let spokes = 12
            for i in 0..<spokes {
                let a = Double(i) / Double(spokes) * 2 * .pi
                var p = Path(); p.move(to: c)
                p.addLine(to: CGPoint(x: c.x + cos(a) * r, y: c.y + sin(a) * r))
                ctx.stroke(p, with: ink, lineWidth: 0.7)
            }
            let rings = min(threads, 14)
            for k in 0..<rings {
                let rr = 40 + Double(k) * 26
                var p = Path()
                for i in 0...spokes {
                    let a = Double(i % spokes) / Double(spokes) * 2 * .pi
                    let pt = CGPoint(x: c.x + cos(a) * rr, y: c.y + sin(a) * rr)
                    if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
                }
                ctx.stroke(p, with: ink, lineWidth: 0.7)
            }
        }
        .accessibilityHidden(true)
    }
}

/// La araña de puntos y líneas (0.18.0, como la de la web): cuerpo rectangular, ocho patas de dos tramos
/// que dan pasitos por parejas alternas, articulaciones en verde. Al pensar cambia a cian y gira un anillo de lectura.
struct SpiderView: View {
    var thinking: Bool
    /// 0.23.0: hacia dónde mira (radianes) y si va caminando: entonces los pasos son más largos y rápidos.
    var heading: Double = -Double.pi / 2
    var walking: Bool = false
    static let pink = Color(red: 1.0, green: 0.31, blue: 0.64)
    static let green = Color(red: 0.24, green: 1.0, blue: 0.60)
    static let cyan = Color(red: 0.37, green: 0.91, blue: 1.0)
    static let angles: [Double] = [38, 72, 110, 148]
    static let rests: [Double] = [70, 62, 60, 72]
    static let l1s: [Double] = [42, 38, 38, 44]
    static let l2s: [Double] = [46, 41, 41, 48]
    static let hipX: [Double] = [8, 3, -3, -8]

    static func knee(hip: CGPoint, foot: CGPoint, a: Double, b: Double, bend: Double) -> CGPoint {
        let dx = Double(foot.x - hip.x), dy = Double(foot.y - hip.y)
        let d = min(a + b - 0.5, max(abs(a - b) + 1, (dx * dx + dy * dy).squareRoot()))
        let cosA = max(-1, min(1, (a * a + d * d - b * b) / (2 * a * d)))
        let k = atan2(dy, dx) + bend * acos(cosA)
        return CGPoint(x: Double(hip.x) + cos(k) * a, y: Double(hip.y) + sin(k) * a)
    }

    var body: some View {
        TimelineView(.animation) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            Canvas { ctx, size in
                let legC = thinking ? Self.cyan : Self.pink
                let jointC = thinking ? Self.pink : Self.green
                let bodyC = thinking ? Self.pink : Self.cyan
                let c = CGPoint(x: size.width / 2, y: size.height / 2 + sin(t * 3.2) * 1.5)
                let h = heading + sin(t * 0.6) * (walking ? 0.05 : 0.22)
                let speed = walking ? 3.4 : (thinking ? 2.4 : 1.2)
                for i in 0..<8 {
                    let side: Double = i < 4 ? -1 : 1
                    let k = i % 4
                    let group = Double((k + (side > 0 ? 1 : 0)) % 2)
                    let ph = (t * speed + group * 0.5).truncatingRemainder(dividingBy: 1)
                    let stride = walking ? 18.0 : 10.0
                    let off: Double = ph < 0.7 ? (0.5 - ph / 0.7) * stride : (-0.5 + (ph - 0.7) / 0.3) * stride
                    let lift: Double = ph >= 0.7 ? sin((ph - 0.7) / 0.3 * .pi) * 6 : 0
                    let a = h + side * Self.angles[k] * .pi / 180
                    let r = Self.rests[k] + lift
                    let foot = CGPoint(x: Double(c.x) + cos(a) * r + cos(h) * off,
                                       y: Double(c.y) + sin(a) * r + sin(h) * off)
                    let hx = Self.hipX[k], hy = side * 5.5
                    let hip = CGPoint(x: Double(c.x) + hx * cos(h) - hy * sin(h),
                                      y: Double(c.y) + hx * sin(h) + hy * cos(h))
                    let kn = Self.knee(hip: hip, foot: foot, a: Self.l1s[k], b: Self.l2s[k], bend: side * (k < 2 ? -1 : 1))
                    var p = Path(); p.move(to: hip); p.addLine(to: kn); p.addLine(to: foot)
                    var glow = ctx
                    glow.addFilter(.shadow(color: legC.opacity(0.7), radius: 3))
                    glow.stroke(p, with: .color(legC), style: StrokeStyle(lineWidth: 1.7, lineCap: .round, lineJoin: .round))
                    ctx.fill(Path(ellipseIn: CGRect(x: kn.x - 2.8, y: kn.y - 2.8, width: 5.6, height: 5.6)), with: .color(jointC))
                    let fr: CGFloat = lift > 0 ? 3.2 : 2.4
                    ctx.fill(Path(ellipseIn: CGRect(x: foot.x - fr, y: foot.y - fr, width: fr * 2, height: fr * 2)), with: .color(jointC))
                }
                if thinking {
                    var ring = Path()
                    ring.addArc(center: c, radius: 58, startAngle: .radians(t * 1.1), endAngle: .radians(t * 1.1 + 2 * .pi), clockwise: false)
                    ctx.stroke(ring, with: .color(bodyC.opacity(0.6)), style: StrokeStyle(lineWidth: 1.2, dash: [3, 6]))
                    let sw = t * 7.5
                    for k in 0..<4 {
                        var arc = Path()
                        arc.addArc(center: c, radius: 70, startAngle: .radians(sw - Double(k) * 0.32),
                                   endAngle: .radians(sw - Double(k) * 0.32 + 0.3), clockwise: false)
                        ctx.stroke(arc, with: .color(bodyC.opacity(0.6 - Double(k) * 0.14)), lineWidth: 1.4)
                    }
                }
                var b = ctx
                b.translateBy(x: c.x, y: c.y)
                b.rotate(by: .radians(h))
                let rect = CGRect(x: -17, y: -8, width: 34, height: 16)
                b.fill(Path(rect), with: .color(Color(red: 0.04, green: 0.05, blue: 0.11).opacity(0.85)))
                var bg = b
                bg.addFilter(.shadow(color: bodyC.opacity(0.9), radius: 5))
                bg.stroke(Path(rect), with: .color(bodyC), lineWidth: 2)
                b.stroke(Path(CGRect(x: -11, y: -4.2, width: 17, height: 8.4)), with: .color(bodyC.opacity(0.5)), lineWidth: 1)
                let cr = 3.6 + sin(t * 5) * 0.6
                var core = b
                core.addFilter(.shadow(color: legC, radius: 6))
                core.fill(Path(ellipseIn: CGRect(x: -2 - cr, y: -cr, width: cr * 2, height: cr * 2)), with: .color(legC))
                b.fill(Path(ellipseIn: CGRect(x: 11.4, y: -5, width: 3.2, height: 3.2)), with: .color(jointC))
                b.fill(Path(ellipseIn: CGRect(x: 11.4, y: 1.8, width: 3.2, height: 3.2)), with: .color(jointC))
            }
        }
        .accessibilityLabel("La araña")
    }
}

/// Fondo del prototipo que eligió Juan: rejilla fina y brillos violeta y verde azulado.
struct Wallpaper: View {
    var body: some View {
        ZStack {
            Color(red: 0.035, green: 0.04, blue: 0.08)
            RadialGradient(colors: [Color(red: 0.2, green: 0.125, blue: 0.37), .clear], center: UnitPoint(x: 0.15, y: 0.05), startRadius: 0, endRadius: 420)
            RadialGradient(colors: [Color(red: 0.055, green: 0.255, blue: 0.32), .clear], center: UnitPoint(x: 0.95, y: 0.95), startRadius: 0, endRadius: 420)
            Canvas { ctx, size in
                var p = Path()
                var x: CGFloat = 0
                while x < size.width { p.move(to: CGPoint(x: x, y: 0)); p.addLine(to: CGPoint(x: x, y: size.height)); x += 28 }
                var y: CGFloat = 0
                while y < size.height { p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: size.width, y: y)); y += 28 }
                ctx.stroke(p, with: .color(SpiderView.cyan.opacity(0.05)), lineWidth: 1)
            }
        }
        .accessibilityHidden(true)
    }
}
