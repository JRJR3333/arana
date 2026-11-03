import Foundation
import UserNotifications

/// 0.53.0 (asistente): «despiértame a las 7», «pon una alarma mañana a las 8 y media», «qué alarmas tengo»
/// y «quita las alarmas». En local, sin gastar API. Suena con un aviso local aunque la app esté cerrada,
/// y si no la quita, le insisto a los cinco minutos.
@MainActor
enum Alarmas {
    static func quick(_ t: String, ahora: Date = Date()) async -> String? {
        guard t.contains("alarma") || t.hasPrefix("despiertame") || t.hasPrefix("despierteme") else { return nil }
        let c = UNUserNotificationCenter.current()
        if let r = Recordar.grupos(#"^(?:pon(?:me)? |programa |crea )?(?:una )?alarma(?: para)?(?: (manana|pasado manana))? (a las? .+)$|^despiert[ae]me(?: (manana|pasado manana))? (a las? .+)$"#, t) {
            let dia = [r[1], r[3]].first { !$0.isEmpty } ?? ""
            let resto = [r[2], r[4]].first { !$0.isEmpty } ?? ""
            var x = " " + resto.replacingOccurrences(of: "de la manana", with: "de la madrugada") + " "
            var d = dia
            for k in ["pasado manana", "manana"] where d.isEmpty && x.contains(" \(k) ") {
                d = k; x = x.replacingOccurrences(of: " \(k) ", with: " "); break
            }
            guard let w = Recordar.cuando(x.trimmingCharacters(in: .whitespaces), ahora: ahora, dia: d) else { return nil }
            guard (try? await c.requestAuthorization(options: [.alert, .sound])) == true else {
                return "No tengo permiso para avisarle. Actívelo en Ajustes → Araña → Notificaciones."
            }
            let f = DateFormatter()
            f.locale = Locale(identifier: "es_ES")
            f.dateFormat = "H:mm"
            let id = "alarm-\(UUID().uuidString)"
            let cal = Calendar.current
            for (k, extra, texto) in [("a", 0.0, "Arriba. Son las \(f.string(from: w.0))."), ("b", 300.0, "Sigo aquí. Ya son las \(f.string(from: w.0.addingTimeInterval(300))).")] {
                let n = UNMutableNotificationContent()
                n.title = "Araña · alarma"
                n.body = texto
                n.sound = .default
                n.threadIdentifier = id
                let comp = cal.dateComponents([.year, .month, .day, .hour, .minute], from: w.0.addingTimeInterval(extra))
                do { try await c.add(UNNotificationRequest(identifier: "\(id)-\(k)", content: n,
                                                           trigger: UNCalendarNotificationTrigger(dateMatching: comp, repeats: false))) }
                catch { return "No he podido poner la alarma." }
            }
            return "Alarma puesta para \(Recordar.dicho(w.0, ahora: ahora)). Si no la quita, le insisto a los cinco minutos."
        }
        let todas = await c.pendingNotificationRequests().filter { $0.identifier.hasPrefix("alarm-") }
        let primera = String(t.split(separator: " ").first ?? "")
        if Temporizadores.cancelar.contains(primera) || primera == "desactiva" {
            guard !todas.isEmpty else { return "No tiene ninguna alarma puesta." }
            c.removePendingNotificationRequests(withIdentifiers: todas.map { $0.identifier })
            let n = todas.filter { $0.identifier.hasSuffix("-a") }.count
            return n <= 1 ? "Alarma quitada." : "Quitadas sus \(n) alarmas."
        }
        guard ["que", "tengo", "hay", "mis", "cuantas", "a que"].contains(where: { t.hasPrefix($0) }) else { return nil }
        let horas = todas.filter { $0.identifier.hasSuffix("-a") }
            .compactMap { ($0.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate() }
            .sorted()
        guard !horas.isEmpty else { return "No tiene ninguna alarma puesta." }
        let lista = horas.prefix(4).map { Recordar.dicho($0, ahora: ahora) }
        return horas.count == 1 ? "Tiene una alarma \(lista[0])." : "Tiene \(horas.count) alarmas: " + lista.joined(separator: ", ") + "."
    }
}
