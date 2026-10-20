import SwiftUI

struct ContentView: View {
    @State private var input = ""
    @State private var bubble = "Buenas. Soy su araña, ya fuera de la web."
    @State private var thinking = false
    @State private var showSettings = false
    @State private var key = Keychain.load()
    @StateObject private var ear = Listener()
    @AppStorage("arana.hilos") private var hilos = 0

    var body: some View {
        ZStack {
            Color(red: 0.07, green: 0.07, blue: 0.10).ignoresSafeArea()
            Telarana(threads: hilos).ignoresSafeArea().allowsHitTesting(false)
            VStack(spacing: 18) {
                HStack { Spacer(); Button { showSettings = true } label: { Image(systemName: "gearshape").font(.title2) } }
                    .foregroundStyle(.white.opacity(0.8)).padding(.horizontal)
                Spacer()
                Text(bubble)
                    .font(.system(.title3, design: .serif).italic())
                    .multilineTextAlignment(.center)
                    .padding(14).background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                    .foregroundStyle(.white).padding(.horizontal)
                SpiderView(thinking: thinking).frame(width: 180, height: 180)
                if thinking { Text("Pensando…").font(.caption.bold()).foregroundStyle(.white.opacity(0.8)) }
                if ear.listening {
                    Text(ear.heard.isEmpty ? "Escuchando…" : ear.heard)
                        .font(.callout).foregroundStyle(.white.opacity(0.85)).padding(.horizontal)
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

/// La araña dibujada: cuerpo, cabeza y ocho patas que se mecen; al pensar, un radar gira alrededor.
struct SpiderView: View {
    var thinking: Bool
    var body: some View {
        TimelineView(.animation) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            Canvas { ctx, size in
                let c = CGPoint(x: size.width / 2, y: size.height / 2 + sin(t * 3.2) * 2)
                let ink = GraphicsContext.Shading.color(.white)
                for i in 0..<8 {
                    let side: Double = i < 4 ? -1 : 1
                    let k = Double(i % 4)
                    let a = side * (0.5 + k * 0.45) + sin(t * 4 + Double(i)) * 0.08
                    let knee = CGPoint(x: c.x + side * 28, y: c.y - 30 + k * 18)
                    let foot = CGPoint(x: c.x + side * (48 + cos(a) * 6), y: c.y - 40 + k * 30)
                    var p = Path(); p.move(to: c); p.addLine(to: knee); p.addLine(to: foot)
                    ctx.stroke(p, with: ink, lineWidth: 1.6)
                }
                ctx.stroke(Path(ellipseIn: CGRect(x: c.x - 15, y: c.y - 2, width: 30, height: 34)), with: ink, lineWidth: 1.6)
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - 8, y: c.y - 20, width: 16, height: 16)), with: ink)
                if thinking {
                    let sw = t * 7.5
                    for k in 0..<4 {
                        var arc = Path()
                        arc.addArc(center: CGPoint(x: c.x, y: c.y - 12), radius: 30,
                                   startAngle: .radians(sw - Double(k) * 0.32), endAngle: .radians(sw - Double(k) * 0.32 + 0.3), clockwise: false)
                        ctx.stroke(arc, with: .color(.white.opacity(0.55 - Double(k) * 0.13)), lineWidth: 1.4)
                    }
                }
            }
        }
        .accessibilityLabel("La araña")
    }
}
