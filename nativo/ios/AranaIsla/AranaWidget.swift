import SwiftUI
import WidgetKit

/// h8: el widget de verdad. La araña en la pantalla de inicio o en la bloqueada; un toque abre la app escuchando.
struct AranaWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "AranaWidget", provider: Reloj()) { e in AranaWidgetView(e: e) }
            .configurationDisplayName("Araña")
            .description("Un toque y la araña le escucha.")
            .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular])
    }
}

struct Momento: TimelineEntry { let date: Date }

/// Cambia el saludo cada hora; no gasta nada.
struct Reloj: TimelineProvider {
    func placeholder(in context: Context) -> Momento { Momento(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (Momento) -> Void) { completion(Momento(date: .now)) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Momento>) -> Void) {
        let cal = Calendar.current
        let now = Date()
        let start = cal.dateInterval(of: .hour, for: now)?.start ?? now
        let entries = [Momento(date: now)] + (1..<8).compactMap { h in cal.date(byAdding: .hour, value: h, to: start).map(Momento.init) }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct AranaWidgetView: View {
    @Environment(\.widgetFamily) var family
    let e: Momento

    var saludo: String {
        let h = Calendar.current.component(.hour, from: e.date)
        return h < 6 ? "Buenas noches" : h < 13 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches"
    }

    var body: some View {
        content
            .widgetURL(URL(string: "arana://escuchar"))
            .containerBackground(for: .widget) { Color(red: 0.04, green: 0.05, blue: 0.09) }
    }

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryCircular:
            ZStack { AccessoryWidgetBackground(); MiniArana(paso: 0, color: .white).padding(7) }
        case .accessoryRectangular:
            HStack(spacing: 8) {
                MiniArana(paso: 0, color: .white).frame(width: 28, height: 28)
                VStack(alignment: .leading) {
                    Text("Araña").font(.headline)
                    Text("Toque y hable").font(.caption)
                }
            }
        default:
            VStack(alignment: .leading, spacing: 6) {
                MiniArana(paso: Calendar.current.component(.hour, from: e.date), color: IslaWidget.cian).frame(width: 46, height: 46)
                Spacer()
                Text(saludo).font(.headline).foregroundStyle(.white)
                Text("Toque y hable").font(.caption.bold()).foregroundStyle(IslaWidget.rosa)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}
