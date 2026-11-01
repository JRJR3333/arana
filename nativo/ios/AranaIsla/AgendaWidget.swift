import EventKit
import SwiftUI
import WidgetKit

/// 0.51.0 (h8): la agenda del día en la pantalla de inicio. Lee el Calendario con el permiso que ya dio a la app;
/// si aún no lo ha dado, pide abrir la araña. Un toque abre la app y le lee la agenda. No gasta API.
struct AgendaWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "AgendaWidget", provider: AgendaReloj()) { e in AgendaWidgetView(e: e) }
            .configurationDisplayName("Agenda de hoy")
            .description("Lo que tiene hoy, contado por la araña.")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct Cita: Hashable {
    let hora: String
    let titulo: String
}

struct AgendaMomento: TimelineEntry {
    let date: Date
    let citas: [Cita]
    let total: Int
    let permiso: Bool
}

struct AgendaReloj: TimelineProvider {
    func placeholder(in context: Context) -> AgendaMomento {
        AgendaMomento(date: .now, citas: [Cita(hora: "10:00", titulo: "Café")], total: 1, permiso: true)
    }
    func getSnapshot(in context: Context, completion: @escaping (AgendaMomento) -> Void) { completion(leer(Date())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<AgendaMomento>) -> Void) {
        let now = Date()
        let cal = Calendar.current
        // Cada media hora (quita lo ya pasado) y siempre a medianoche (día nuevo).
        var fechas = (0..<8).compactMap { cal.date(byAdding: .minute, value: 30 * $0, to: now) }
        let manana = cal.startOfDay(for: cal.date(byAdding: .day, value: 1, to: now)!)
        fechas = fechas.filter { $0 < manana } + [manana]
        completion(Timeline(entries: fechas.map(leer), policy: .atEnd))
    }

    /// Lo que queda del día desde `d` (lo de todo el día cuenta siempre).
    func leer(_ d: Date) -> AgendaMomento {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            return AgendaMomento(date: d, citas: [], total: 0, permiso: false)
        }
        let store = EKEventStore()
        let cal = Calendar.current
        let fin = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: d))!
        let evs = store.events(matching: store.predicateForEvents(withStart: cal.startOfDay(for: d), end: fin, calendars: nil))
            .filter { $0.isAllDay || ($0.endDate ?? .distantPast) > d }
            .sorted { ($0.isAllDay ? 0 : 1, $0.startDate ?? .distantPast) < ($1.isAllDay ? 0 : 1, $1.startDate ?? .distantPast) }
        let es = Locale(identifier: "es_ES")
        let citas = evs.prefix(4).map { e in
            Cita(hora: e.isAllDay ? "Día" : (e.startDate ?? d).formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(es)),
                 titulo: e.title ?? "Algo")
        }
        return AgendaMomento(date: d, citas: Array(citas), total: evs.count, permiso: true)
    }
}

struct AgendaWidgetView: View {
    @Environment(\.widgetFamily) var family
    let e: AgendaMomento

    var cuantas: Int { family == .systemMedium ? 4 : family == .systemSmall ? 3 : 2 }

    var aviso: String {
        if !e.permiso { return "Abra la araña y pídale su agenda." }
        return e.total == 0 ? "Hoy no tiene nada. Día libre." : ""
    }

    var body: some View {
        content
            .widgetURL(URL(string: "arana://agenda"))
            .containerBackground(for: .widget) { Color(red: 0.04, green: 0.05, blue: 0.09) }
    }

    @ViewBuilder private var content: some View {
        if family == .accessoryRectangular {
            VStack(alignment: .leading, spacing: 1) {
                Text("Hoy").font(.headline)
                if aviso.isEmpty {
                    ForEach(e.citas.prefix(cuantas), id: \.self) { c in Text("\(c.hora) \(c.titulo)").font(.caption).lineLimit(1) }
                } else { Text(aviso).font(.caption).lineLimit(2) }
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    MiniArana(paso: Calendar.current.component(.minute, from: e.date) / 30, color: IslaWidget.cian).frame(width: 22, height: 22)
                    Text(e.date.formatted(.dateTime.weekday(.wide).day().locale(Locale(identifier: "es_ES"))).capitalized)
                        .font(.caption.bold()).foregroundStyle(IslaWidget.rosa)
                }
                if aviso.isEmpty {
                    ForEach(e.citas.prefix(cuantas), id: \.self) { c in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(c.hora).font(.caption.monospacedDigit()).foregroundStyle(IslaWidget.cian)
                            Text(c.titulo).font(.caption).foregroundStyle(.white).lineLimit(1)
                        }
                    }
                    if e.total > cuantas { Text("y \(e.total - cuantas) más").font(.caption2).foregroundStyle(.secondary) }
                } else {
                    Text(aviso).font(.footnote).foregroundStyle(.white)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}
