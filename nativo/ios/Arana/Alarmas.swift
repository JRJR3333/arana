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
        if let r = await repetida(t, ahora: ahora, c: c) { return r }
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
            let n = Set(todas.map { $0.content.threadIdentifier }).count
            return n <= 1 ? "Alarma quitada." : "Quitadas sus \(n) alarmas."
        }
        guard ["que", "tengo", "hay", "mis", "cuantas", "a que"].contains(where: { t.hasPrefix($0) }) else { return nil }
        // 0.54.0: las que se repiten son varios avisos (uno por día); se cuentan como una sola alarma
        var porHilo: [String: (Date, String?)] = [:]
        for r in todas where r.identifier.hasSuffix("-a") {
            guard let d = (r.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate() else { continue }
            let k = r.content.threadIdentifier
            if let p = porHilo[k], p.0 <= d { continue }
            porHilo[k] = (d, r.content.userInfo["dias"] as? String)
        }
        let horas = porHilo.values.sorted { $0.0 < $1.0 }
        guard !horas.isEmpty else { return "No tiene ninguna alarma puesta." }
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_ES")
        f.dateFormat = "H:mm"
        let lista = horas.prefix(4).map { h in h.1.map { "\($0) a las \(f.string(from: h.0))" } ?? Recordar.dicho(h.0, ahora: ahora) }
        return horas.count == 1 ? "Tiene una alarma \(lista[0])." : "Tiene \(horas.count) alarmas: " + lista.joined(separator: ", ") + "."
    }

    /// 0.54.0 (asistente): alarmas que se repiten. «despiértame los días laborables a las 7»,
    /// «alarma todos los días a las 8», «pon una alarma los sábados a las 10». Un aviso por día de la semana.
    static let frecuencias: [(String, String, [Int])] = {
        var f: [(String, String, [Int])] = [
            ("todos los dias", "todos los días", Array(1...7)), ("cada dia", "todos los días", Array(1...7)),
            ("los dias laborables", "entre semana", Array(2...6)), ("los dias de diario", "entre semana", Array(2...6)),
            ("entre semana", "entre semana", Array(2...6)), ("de lunes a viernes", "entre semana", Array(2...6)),
            ("los fines de semana", "los fines de semana", [1, 7]), ("el fin de semana", "los fines de semana", [1, 7]),
            ("cada fin de semana", "los fines de semana", [1, 7]),
        ]
        let dias = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"]
        let bien = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"]
        for (i, d) in dias.enumerated() {
            let pl = d.hasSuffix("s") ? d : d + "s"
            f.append(("los \(pl)", "los \(bien[i])", [i + 1]))
            f.append(("cada \(d)", "los \(bien[i])", [i + 1]))
        }
        return f
    }()

    static func repetida(_ t: String, ahora: Date, c: UNUserNotificationCenter) async -> String? {
        let x0 = " " + t + " "
        guard let fq = frecuencias.first(where: { x0.contains(" \($0.0) ") }) else { return nil }
        let (frase, dicho, dias) = fq
        var x = x0.replacingOccurrences(of: " \(frase) ", with: " ").replacingOccurrences(of: "de la manana", with: "de la madrugada")
        x = x.trimmingCharacters(in: .whitespaces)
        guard Recordar.grupos(#"^(?:(?:pon(?:me)? |programa |crea )?(?:una )?alarma(?: para)?|despiert[ae]me) a las? "#, x) != nil,
              let r = Recordar.grupos(#"(a las? .+)$"#, x),
              let w = Recordar.cuando(r[1], ahora: ahora, dia: "") else { return nil }
        guard (try? await c.requestAuthorization(options: [.alert, .sound])) == true else {
            return "No tengo permiso para avisarle. Actívelo en Ajustes → Araña → Notificaciones."
        }
        let cal = Calendar.current
        let h = cal.component(.hour, from: w.0), m = cal.component(.minute, from: w.0)
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_ES")
        f.dateFormat = "H:mm"
        let id = "alarm-\(UUID().uuidString)"
        let hora = f.string(from: w.0), insiste = f.string(from: w.0.addingTimeInterval(300))
        for d in dias {
            for (k, extra, texto) in [("a", 0, "Arriba. Son las \(hora)."), ("b", 5, "Sigo aquí. Ya son las \(insiste).")] {
                let n = UNMutableNotificationContent()
                n.title = "Araña · alarma"
                n.body = texto
                n.sound = .default
                n.threadIdentifier = id
                n.userInfo = ["dias": dicho]
                // cinco minutos después; si pasa de medianoche, es ya el día siguiente
                let total = h * 60 + m + extra
                var comp = DateComponents()
                comp.weekday = total >= 1440 ? d % 7 + 1 : d
                comp.hour = (total / 60) % 24
                comp.minute = total % 60
                do { try await c.add(UNNotificationRequest(identifier: "\(id)-\(d)-\(k)", content: n,
                                                           trigger: UNCalendarNotificationTrigger(dateMatching: comp, repeats: true))) }
                catch { return "No he podido poner la alarma." }
            }
        }
        return "Alarma puesta \(dicho) a las \(hora). Si no la quita, le insisto a los cinco minutos."
    }
}
