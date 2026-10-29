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
            case "call", "message", "whatsapp":
                if let f = await aContacto(s) { fails.append(f) }
            case "reminder":
                // 0.48.0 (h7): también a una hora («a las 18:30»), no solo dentro de unos minutos
                let at = parseWhen(s.when) ?? ((s.minutes ?? 0) > 0 ? Date().addingTimeInterval(TimeInterval((s.minutes ?? 0) * 60)) : nil)
                let ok = await addReminder(s.text ?? "Recordatorio", at: at)
                if !ok { fails.append("No tengo permiso para Recordatorios.") }
            case "timer":
                let secs = (s.minutes ?? 0) * 60 + (s.seconds ?? 0)
                if secs <= 0 { fails.append("¿Para cuánto tiempo?") }
                else if !(await addTimer(s.text ?? "Su temporizador", seconds: secs)) { fails.append("No tengo permiso para avisarle. Actívelo en Ajustes → Araña → Notificaciones.") }
            case "event":
                fails.append(await addEvent(s.text ?? "Cita", when: s.when, minutes: s.minutes, duration: s.duration ?? 60))
            case "music":
                if let f = await Musica.run(action: s.action, query: s.text) { fails.append(f) }
            case "agenda":
                fails.append(await agenda(days: s.days ?? 0))
            case "search":
                // 0.44.0 (#45): buscar en internet con Safari
                if let u = searchURL(s.text ?? "") { _ = await UIApplication.shared.open(u) }
            default:
                fails.append("Aún no sé hacer «\(s.type)».")
            }
        }
        return fails
    }

    /// 0.46.0 (h7): llamar, SMS y WhatsApp, con el número o con el nombre del contacto (lo busca en Contactos).
    /// Devuelve lo que hay que decir si algo no salió; enviar lo pulsa Juan (iOS no deja que nadie más lo pulse).
    static func aContacto(_ s: Step) async -> String? {
        var tel = (s.phone ?? "").filter { "+0123456789".contains($0) }
        var nombre = ""
        if tel.isEmpty, let quien = s.to?.trimmingCharacters(in: .whitespaces), !quien.isEmpty {
            guard let c = await Contactos.buscar(quien) else {
                if s.type == "call" { return "No encuentro a \(quien) en sus contactos." }
                return await abrirMensaje(s, tel: "") ? "No encuentro a \(quien) en sus contactos. Elíjalo usted; el texto ya va escrito." : "No puedo abrir la app."
            }
            tel = c.tel.filter { "+0123456789".contains($0) }; nombre = c.nombre
        }
        if s.type == "call" {
            guard !tel.isEmpty, let u = URL(string: "tel:" + tel) else { return "¿A quién llamo?" }
            _ = await UIApplication.shared.open(u)
            return nil
        }
        let ok = await abrirMensaje(s, tel: tel)
        if !ok { return s.type == "whatsapp" ? "No encuentro WhatsApp en este iPhone." : "No puedo abrir Mensajes." }
        return nombre.isEmpty ? nil : "Lo dejo escrito para \(nombre). Pulse enviar."
    }

    private static func abrirMensaje(_ s: Step, tel: String) async -> Bool {
        let t = (s.text ?? "").addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        let url: String
        if s.type == "whatsapp" {
            url = tel.isEmpty ? "whatsapp://send?text=\(t)" : "https://wa.me/\(Contactos.internacional(tel))?text=\(t)"
        } else {
            url = "sms:\(tel)&body=\(t)"
        }
        guard let u = URL(string: url) else { return false }
        return await UIApplication.shared.open(u)
    }

    static func searchURL(_ q: String) -> URL? {
        var c = URLComponents(string: "https://www.google.com/search")
        c?.queryItems = [URLQueryItem(name: "q", value: q)]
        return c?.url
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

    static func addReminder(_ title: String, at when: Date?) async -> Bool {
        guard (try? await store.requestFullAccessToReminders()) == true else { return false }
        let r = EKReminder(eventStore: store)
        r.title = title
        r.calendar = store.defaultCalendarForNewReminders()
        if let when {
            r.addAlarm(EKAlarm(absoluteDate: when))
            r.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: when)
        }
        do { try store.save(r, commit: true); return true } catch { return false }
    }
}
