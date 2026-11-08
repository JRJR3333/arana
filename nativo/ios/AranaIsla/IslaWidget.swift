import ActivityKit
import SwiftUI
import WidgetKit

@main
struct AranaIslaBundle: WidgetBundle {
    var body: some Widget {
        IslaWidget()
        AranaWidget()
        AgendaWidget()
        if #available(iOS 18.0, *) { AranaControl(); LuzControl(); TemporizadorControl(); AlarmaControl() }
    }
}

/// h8: la araña en la Isla Dinámica y en la pantalla bloqueada mientras cumple una orden.
struct IslaWidget: Widget {
    static let rosa = Color(red: 1.0, green: 0.36, blue: 0.62)
    static let cian = Color(red: 0.35, green: 0.9, blue: 1.0)

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AranaAttributes.self) { ctx in
            HStack(spacing: 12) {
                MiniArana(paso: ctx.state.paso, color: Self.cian).frame(width: 36, height: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(ctx.isStale && ctx.state.fin != nil ? "¡Tiempo!" : ctx.state.estado).font(.headline)
                    if !ctx.attributes.orden.isEmpty { Text("«\(ctx.attributes.orden)»").font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                // 0.52.0 (h8): la cuenta atrás del temporizador
                if let r = Self.rango(ctx.state) {
                    VStack(alignment: .trailing, spacing: 4) {
                        Text(timerInterval: r, countsDown: true).font(.title.monospacedDigit().bold())
                            .foregroundStyle(Self.cian).frame(maxWidth: 110, alignment: .trailing)
                        if !ctx.isStale { Self.parar(r.upperBound) }
                    }
                }
            }
            .padding()
            .activityBackgroundTint(Color(red: 0.04, green: 0.05, blue: 0.09))
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { ctx in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { MiniArana(paso: ctx.state.paso, color: Self.cian).frame(width: 34, height: 34) }
                DynamicIslandExpandedRegion(.trailing) {
                    if let r = Self.rango(ctx.state) {
                        Text(timerInterval: r, countsDown: true).font(.title2.monospacedDigit().bold())
                            .foregroundStyle(Self.cian).frame(maxWidth: 90, alignment: .trailing)
                    } else {
                        Text(ctx.state.estado).font(.caption.bold()).foregroundStyle(Self.cian)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if !ctx.attributes.orden.isEmpty { Text("«\(ctx.attributes.orden)»").font(.caption).lineLimit(1) }
                    else if let r = Self.rango(ctx.state) {
                        HStack {
                            Text(ctx.state.estado).font(.caption).lineLimit(1)
                            Spacer()
                            if !ctx.isStale { Self.parar(r.upperBound) }
                        }
                    }
                }
            } compactLeading: {
                MiniArana(paso: ctx.state.paso, color: Self.rosa).frame(width: 18, height: 18)
            } compactTrailing: {
                if let r = Self.rango(ctx.state) {
                    Text(timerInterval: r, countsDown: true).font(.caption.monospacedDigit().bold())
                        .foregroundStyle(Self.cian).frame(maxWidth: 44)
                } else {
                    Text(ctx.state.estado == "Hecho" ? "✓" : "…").font(.caption.bold()).foregroundStyle(Self.cian)
                }
            } minimal: {
                MiniArana(paso: ctx.state.paso, color: Self.rosa).frame(width: 16, height: 16)
            }
        }
    }
}

extension IslaWidget {
    /// El tramo de la cuenta atrás, si la actividad es un temporizador.
    static func rango(_ e: AranaAttributes.ContentState) -> ClosedRange<Date>? {
        guard let i = e.inicio, let f = e.fin, i < f else { return nil }
        return i...f
    }

    /// 0.54.0 (h8): «Parar» cancela ese temporizador sin abrir la app.
    static func parar(_ fin: Date) -> some View {
        Button(intent: PararTemporizadorIntent(fin: fin)) {
            Label("Parar", systemImage: "stop.fill").font(.caption.bold())
        }
        .tint(rosa)
        .buttonStyle(.borderedProminent)
    }
}

/// La araña de puntos y líneas, en pequeño. Cambia la postura de las patas con cada paso.
struct MiniArana: View {
    var paso: Int
    var color: Color
    var body: some View {
        Canvas { g, size in
            let r = min(size.width, size.height) / 2
            // 0.53.0 (h8): con cada paso se balancea a un lado y a otro, como si caminara
            let vaiven: [CGFloat] = [0, 0.06, 0, -0.06]
            let c = CGPoint(x: size.width / 2 + vaiven[abs(paso) % 4] * r, y: size.height / 2)
            let alt: CGFloat = paso % 2 == 0 ? 0.12 : -0.12
            var patas = Path()
            for i in 0..<8 {
                let lado: CGFloat = i < 4 ? -1 : 1
                let k = CGFloat(i % 4)
                let ang = (-0.75 + k * 0.5 + (i % 2 == 0 ? alt : -alt)) * .pi / 2
                let rodilla = CGPoint(x: c.x + lado * cos(ang) * r * 0.55, y: c.y + sin(ang) * r * 0.55 - r * 0.2)
                let pie = CGPoint(x: c.x + lado * cos(ang) * r * 0.95, y: c.y + sin(ang) * r * 0.95 + r * 0.15)
                patas.move(to: c); patas.addLine(to: rodilla); patas.addLine(to: pie)
            }
            g.stroke(patas, with: .color(color), lineWidth: max(1, r * 0.08))
            let cuerpo = CGRect(x: c.x - r * 0.28, y: c.y - r * 0.22, width: r * 0.56, height: r * 0.44)
            g.fill(Path(roundedRect: cuerpo, cornerRadius: r * 0.1), with: .color(color))
        }
    }
}
