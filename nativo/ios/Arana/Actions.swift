import Foundation
import EventKit
import UIKit
import UserNotifications

/// Lo que la araña sabe hacer de verdad en el iPhone, desde su propio código.
@MainActor
enum Actions {
    private static let store = EKEventStore()

    /// Ejecuta los pasos y devuelve una frase por cada uno que no salió.
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
