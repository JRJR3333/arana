import SwiftUI

struct ContentView: View {
    @State private var input = ""
    @State private var bubble = "Buenas. Soy su araña, ya fuera de la web."
    @State private var thinking = false
    @State private var showSettings = false
    @State private var key = Keychain.load()
    @StateObject private var ear = Listener()
    @ObservedObject private var metro = Metronomo.shared
    @AppStorage("arana.hilos") private var hilos = 0

    var body: some View {
        ZStack {
            Wallpaper().ignoresSafeArea()
            Telarana(threads: hilos).ignoresSafeArea().allowsHitTesting(false)
            VStack(spacing: 18) {
                HStack { Spacer(); Button { showSettings = true } label: { Image(systemName: "gearshape").font(.title2) } }
                    .foregroundStyle(.white.opacity(0.8)).padding(.horizontal)
                Spacer()
                Text(bubble)
                    .font(.system(.callout, design: .monospaced).weight(.medium))
                    .multilineTextAlignment(.center)
                    .padding(14).background(Color(red: 0.04, green: 0.05, blue: 0.09).opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(SpiderView.pink, lineWidth: 1))
                    .foregroundStyle(.white).padding(.horizontal)
                SpiderView(thinking: thinking).frame(width: 240, height: 240)
                if thinking { Text("Pensando…").font(.caption.bold()).foregroundStyle(.white.opacity(0.8)) }
                if ear.listening {
                    Text(ear.heard.isEmpty ? "Escuchando…" : ear.heard)
                        .font(.callout).foregroundStyle(.white.opacity(0.85)).padding(.horizontal)
                }
                if metro.bpm > 0 {
                    Button { metro.stop() } label: { Label("♩ \(metro.bpm) · Parar", systemImage: "metronome") }
                        .buttonStyle(.bordered).tint(SpiderView.green)
                }
                Spacer()
                HStack {
                    Button(action: toggleEar) {
                        Image(systemName: ear.listening ? "stop.circle.fill" : "mic.circle.fill").font(.system(size: 34))
                    }
                    .foregroundStyle(ear.listening ? Color.red : Color.white)
                    .disabled(thinking)
                    .accessibilityLabel(ear.listening ? "Dejar de escuchar" : "Hablar")
                    TextField("Dígame qué hacer", text: $input)
                        .textFieldStyle(.roundedBorder).submitLabel(.go).onSubmit(send)
                    Button("Ir", action: send).buttonStyle(.borderedProminent).disabled(thinking)
                }.padding()
            }
        }
        .sheet(isPresented: $showSettings) { settings }
        .onOpenURL { u in
            // h8: el widget abre la app escuchando (arana://escuchar).
            if u.host == "escuchar", !ear.listening, !thinking { toggleEar() }
        }
        .onChange(of: ear.done) { _, said in
            guard let said else { return }
            ear.done = nil; input = said; send()
        }
    }

    private var settings: some View {
        NavigationStack {
            Form {
                Section("Cerebro (Claude)") {
                    SecureField("Clave de API (sk-ant-…)", text: $key)
                    Button("Guardar clave") { Keychain.save(key.trimmingCharacters(in: .whitespacesAndNewlines)); showSettings = false; bubble = "Clave guardada. Ya puedo pensar." }
                }
                Section { Text("La clave se guarda solo en el llavero de este iPhone.").font(.footnote) }
                Section("Lo que sé de usted") {
                    if Memory.facts.isEmpty { Text("Aún nada. Cuénteme algo de usted y lo recordaré.").font(.footnote) }
                    ForEach(Memory.facts, id: \.self) { Text($0).font(.footnote) }
                }
            }.navigationTitle("Ajustes")
        }
    }

    private func send() {
        let t = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !thinking else { return }
        input = ""; thinking = true
        Task {
            let text = await Brain.ask(t)
            bubble = text; Voice.shared.say(text)
            hilos = UserDefaults.standard.integer(forKey: "arana.hilos")
            thinking = false
        }
    }

    private func toggleEar() {
        if ear.listening { ear.stop(); return }
        Task { if let msg = await ear.start() { bubble = msg } }
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
                let h = -Double.pi / 2 + sin(t * 0.6) * 0.22
                let speed = thinking ? 2.4 : 1.2
                for i in 0..<8 {
                    let side: Double = i < 4 ? -1 : 1
                    let k = i % 4
                    let group = Double((k + (side > 0 ? 1 : 0)) % 2)
                    let ph = (t * speed + group * 0.5).truncatingRemainder(dividingBy: 1)
                    let stride = 10.0
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
