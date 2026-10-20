import Foundation
import EventKit
import UIKit
import UserNotifications

/// Lo que la araña sabe hacer de verdad en el iPhone, desde su propio código.
@MainActor
enum Actions {
    private static let store = EKEventStore()

    /// Ejecuta los pasos y devuelve lo que hay que añadir a la respuesta: lo que no salió y lo que leyó (agenda).
    static func run(_ steps: [Step]) async -> [String] {
        var fails: [String] = []
        for s in steps {
            switch s.type {
            case "open":
                if let u = s.url.flatMap(URL.init(string:)) { _ = await UIApplication.shared.open(u) } else { fails.append("No sé abrir eso.") }
            case "call":
                if let p = s.phone, let u = URL(string: "tel:" + p.filter { "+0123456789".contains($0) }) { _ = await UIApplication.shared.open(u) }
            case "message":
                let t = (s.text ?? "").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                if let u = URL(string: "sms:\(s.phone ?? "")&body=\(t)") { _ = await UIApplication.shared.open(u) }
            case "reminder":
                let ok = await addReminder(s.text ?? "Recordatorio", minutes: s.minutes ?? 0)
                if !ok { fails.append("No tengo permiso para Recordatorios.") }
            case "timer":
                let secs = (s.minutes ?? 0) * 60 + (s.seconds ?? 0)
                if secs <= 0 { fails.append("¿Para cuánto tiempo?") }
                else if !(await addTimer(s.text ?? "Su temporizador", seconds: secs)) { fails.append("No tengo permiso para avisarle. Actívelo en Ajustes → Araña → Notificaciones.") }
            case "event":
                fails.append(await addEvent(s.text ?? "Cita", when: s.when, minutes: s.minutes, duration: s.duration ?? 60))
            case "agenda":
                fails.append(await agenda(days: s.days ?? 0))
            default:
                fails.append("Aún no sé hacer «\(s.type)».")
            }
        }
        return fails
    }

    /// Temporizador o alarma: un aviso local que suena aunque la app esté cerrada.
    static func addTimer(_ title: String, seconds: Int) async -> Bool {
        let c = UNUserNotificationCenter.current()
        guard (try? await c.requestAuthorization(options: [.alert, .sound])) == true else { return false }
        let n = UNMutableNotificationContent()
        n.title = "Araña"
        n.body = title
        n.sound = .default
        let t = UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(seconds), repeats: false)
        do { try await c.add(UNNotificationRequest(identifier: "timer-\(UUID().uuidString)", content: n, trigger: t)); return true }
        catch { return false }
    }

    /// Fecha local «AAAA-MM-DDTHH:MM» que manda el cerebro.
    static func parseWhen(_ w: String?) -> Date? {
        guard let w else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        for fmt in ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd HH:mm", "yyyy-MM-dd"] {
            f.dateFormat = fmt
            if let d = f.date(from: w) { return d }
        }
        return nil
    }

    /// Evento en el calendario. Devuelve la frase que confirma, o el problema.
    static func addEvent(_ title: String, when: String?, minutes: Int?, duration: Int) async -> String {
        guard (try? await store.requestFullAccessToEvents()) == true else { return "No tengo permiso para el Calendario. Actívelo en Ajustes → Araña." }
        guard let start = parseWhen(when) ?? minutes.map({ Date().addingTimeInterval(TimeInterval($0 * 60)) }) else { return "¿Para qué día y hora?" }
        let e = EKEvent(eventStore: store)
        e.title = title
        e.startDate = start
        e.endDate = start.addingTimeInterval(TimeInterval(max(duration, 5) * 60))
        e.calendar = store.defaultCalendarForNewEvents
        e.addAlarm(EKAlarm(relativeOffset: -15 * 60))
        do { try store.save(e, span: .thisEvent, commit: true) } catch { return "No he podido guardar el evento." }
        return "Apuntado en su calendario: \(title), \(start.formatted(.dateTime.weekday(.wide).day().hour().minute().locale(Locale(identifier: "es_ES"))))."
    }

    /// Lee la agenda de hoy (0) o de mañana (1). En local: no gasta API.
    static func agenda(days: Int) async -> String {
        guard (try? await store.requestFullAccessToEvents()) == true else { return "No tengo permiso para el Calendario. Actívelo en Ajustes → Araña." }
        let cal = Calendar.current
        let day = cal.startOfDay(for: cal.date(byAdding: .day, value: days, to: Date())!)
        let end = cal.date(byAdding: .day, value: 1, to: day)!
        let evs = store.events(matching: store.predicateForEvents(withStart: day, end: end, calendars: nil))
            .sorted { $0.startDate! < $1.startDate! }
        let cuando = days == 1 ? "Mañana" : "Hoy"
        if evs.isEmpty { return "\(cuando) no tiene nada en el calendario." }
        let es = Locale(identifier: "es_ES")
        let items = evs.prefix(5).map { e in
            e.isAllDay ? "\(e.title ?? "algo") (todo el día)" : "\(e.startDate.formatted(.dateTime.hour().minute().locale(es))) \(e.title ?? "algo")"
        }
        let mas = evs.count > 5 ? " y \(evs.count - 5) más" : ""
        return "\(cuando) tiene: " + items.joined(separator: "; ") + mas + "."
    }

    static func addReminder(_ title: String, minutes: Int) async -> Bool {
        guard (try? await store.requestFullAccessToReminders()) == true else { return false }
        let r = EKReminder(eventStore: store)
        r.title = title
        r.calendar = store.defaultCalendarForNewReminders()
        if minutes > 0 {
            let when = Date().addingTimeInterval(TimeInterval(minutes * 60))
            r.addAlarm(EKAlarm(absoluteDate: when))
            r.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: when)
        }
        do { try store.save(r, commit: true); return true } catch { return false }
    }
}
