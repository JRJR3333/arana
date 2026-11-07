import Foundation
import UserNotifications

/// 0.52.0 (asistente): «cuánto le queda al temporizador», «qué temporizadores tengo» y
/// «cancela el temporizador», en local. Los temporizadores son los avisos «timer-…» pendientes.
@MainActor
enum Temporizadores {
    static let cancelar = ["cancela", "cancelame", "quita", "quitame", "para", "parame", "anula", "borra", "elimina", "apaga", "deten", "olvida"]

    static func quick(_ t: String) async -> String? {
        let habla = t.contains("temporizador") || t.contains("cuenta atras")
        let suelta = ["cuanto queda", "cuanto falta", "cuanto le queda", "cuanto me queda"].contains(t)
        guard habla || suelta else { return nil }
        let primera = String(t.split(separator: " ").first ?? "")
        let c = UNUserNotificationCenter.current()
        let ahora = Date()
        let pendientes = await c.pendingNotificationRequests()
            .filter { $0.identifier.hasPrefix("timer-") }
            .compactMap { r -> (String, String, Date)? in
                guard let d = (r.trigger as? UNTimeIntervalNotificationTrigger)?.nextTriggerDate(), d > ahora else { return nil }
                return (r.identifier, r.content.body, d)
            }
            .sorted { $0.2 < $1.2 }
        if habla, cancelar.contains(primera) {
            guard !pendientes.isEmpty else { Isla.limpiar(todos: true); return "No tiene ningún temporizador en marcha." }
            c.removePendingNotificationRequests(withIdentifiers: pendientes.map { $0.0 })
            Isla.limpiar(todos: true)
            return pendientes.count == 1 ? "Temporizador cancelado." : "Cancelados sus \(pendientes.count) temporizadores."
        }
        let pregunta = suelta || ["cuanto", "como", "que", "tengo", "hay", "queda", "falta", "mis", "cuantos"].contains(primera)
        guard pregunta else { return nil }
        if pendientes.isEmpty { return suelta ? nil : "No tiene ningún temporizador en marcha." }
        let partes = pendientes.prefix(3).map { p -> String in
            let nombre = p.1 == "Su temporizador" ? "" : " (\(p.1))"
            return resto(p.2.timeIntervalSince(ahora)) + nombre
        }
        if partes.count == 1 { return (partes[0].hasPrefix("1 ") ? "Queda " : "Quedan ") + partes[0] + "." }
        return "Tiene \(pendientes.count) temporizadores. Quedan " + partes.dropLast().joined(separator: ", ") + " y " + partes.last! + "."
    }

    /// 0.57.0 (asistente): «añade 5 minutos al temporizador», «5 minutos más», «alárgalo 10 minutos».
    /// Alarga el que antes acaba: quita su aviso y su Isla y lo vuelve a poner con el tiempo de más.
    static func alargar(_ t: String) async -> String? {
        let n = #"(\d{1,3}|un|una|media|dos|tres|cuatro|cinco|diez|quince|veinte|treinta)"#
        let u = #"(minutos?|min|segundos?|horas?)"#
        let verbo = #"(?:anade|anadele|anademe|suma|sumale|agrega|agregale|alarga|alargalo|alargale|dale|dame|ponle|ponme)"#
        let pat = "^(?:\(verbo) )?(?:(?:al|el) temporizador )?(?:otros? |unos? )?\(n) \(u)(?: mas)?(?: (?:al|el) temporizador)?$"
        guard let r = Recordar.grupos(pat, t) else { return nil }
        let tiene = t.contains("temporizador")
        // sin verbo ni «temporizador», solo «5 minutos más»
        guard tiene || t.contains(" mas") || !t.hasPrefix(r[1]) else { return nil }
        let palabras = ["un": 1.0, "una": 1, "media": 0.5, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "diez": 10, "quince": 15, "veinte": 20, "treinta": 30]
        let v = palabras[r[1]] ?? Double(r[1]) ?? 0
        let extra = Int(v * (r[2].hasPrefix("h") || r[1] == "media" ? 3600 : r[2].hasPrefix("s") ? 1 : 60))
        guard extra > 0, extra <= 36_000 else { return nil }
        let ahora = Date()
        let pendientes = await UNUserNotificationCenter.current().pendingNotificationRequests()
            .filter { $0.identifier.hasPrefix("timer-") }
            .compactMap { r -> (String, Date)? in
                guard let d = (r.trigger as? UNTimeIntervalNotificationTrigger)?.nextTriggerDate(), d > ahora else { return nil }
                return (r.content.body, d)
            }
            .sorted { $0.1 < $1.1 }
        guard let p = pendientes.first else { return tiene ? "No tiene ningún temporizador en marcha." : nil }
        let quedan = Int(p.1.timeIntervalSince(ahora).rounded()) + extra
        await Parar.temporizador(fin: p.1)
        guard await Actions.addTimer(p.0, seconds: quedan) else { return "No tengo permiso para avisarle. Actívelo en Ajustes → Araña → Notificaciones." }
        Isla.temporizador(p.0, segundos: quedan)
        return "Hecho: \(resto(TimeInterval(extra))) más. Ahora quedan \(resto(TimeInterval(quedan)))."
    }

    /// 250 s → «4 minutos y 10 segundos».
    static func resto(_ s: TimeInterval) -> String {
        let n = max(1, Int(s.rounded()))
        let h = n / 3600, m = (n % 3600) / 60, sg = n % 60
        var p: [String] = []
        if h > 0 { p.append("\(h) hora\(h == 1 ? "" : "s")") }
        if m > 0 { p.append("\(m) minuto\(m == 1 ? "" : "s")") }
        if sg > 0 && h == 0 { p.append("\(sg) segundo\(sg == 1 ? "" : "s")") }
        return p.count > 1 ? p.dropLast().joined(separator: ", ") + " y " + p.last! : p.first ?? "nada"
    }
}
