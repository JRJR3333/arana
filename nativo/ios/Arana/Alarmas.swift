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
        if let r = await deSiempre(t, ahora: ahora) { return r }
        if let r = await cuantoFalta(t, ahora: ahora, c: c) { return r }
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
            let f = hm
            let id = "alarm-\(UUID().uuidString)"
            let cal = Calendar.current
            for (k, extra, texto) in [("a", 0.0, "Arriba. Son las \(f.string(from: w.0))."), ("b", 300.0, "Sigo aquí. Ya son las \(f.string(from: w.0.addingTimeInterval(300))).")] {
                let n = UNMutableNotificationContent()
                n.title = "Araña · alarma"
                n.body = texto
                n.sound = .default
                n.threadIdentifier = id
                n.categoryIdentifier = categoria
                let comp = cal.dateComponents([.year, .month, .day, .hour, .minute], from: w.0.addingTimeInterval(extra))
                do { try await c.add(UNNotificationRequest(identifier: "\(id)-\(k)", content: n,
                                                           trigger: UNCalendarNotificationTrigger(dateMatching: comp, repeats: false))) }
                catch { return "No he podido poner la alarma." }
            }
            // 0.56.0: me acuerdo de la última hora de despertarse, para proponerla en «buenas noches»
            if cal.component(.hour, from: w.0) < 12 { UserDefaults.standard.set(f.string(from: w.0), forKey: ultimaKey) }
            return "Alarma puesta para \(Recordar.dicho(w.0, ahora: ahora)). Si no la quita, le insisto a los cinco minutos."
        }
        let todas = await c.pendingNotificationRequests().filter { $0.identifier.hasPrefix("alarm-") }
        let primera = String(t.split(separator: " ").first ?? "")
        if Temporizadores.cancelar.contains(primera) || primera == "desactiva" {
            guard !todas.isEmpty else { return "No tiene ninguna alarma puesta." }
            if let r = quitarUna(t, todas: todas, ahora: ahora, c: c) { return r }
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
        let f = hm
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
        let f = hm
        let id = "alarm-\(UUID().uuidString)"
        let hora = f.string(from: w.0), insiste = f.string(from: w.0.addingTimeInterval(300))
        for d in dias {
            for (k, extra, texto) in [("a", 0, "Arriba. Son las \(hora)."), ("b", 5, "Sigo aquí. Ya son las \(insiste).")] {
                let n = UNMutableNotificationContent()
                n.title = "Araña · alarma"
                n.body = texto
                n.sound = .default
                n.threadIdentifier = id
                n.categoryIdentifier = categoria
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

    /// 0.55.0 (asistente): «quita la alarma de las 7» quita solo esa (y su insistencia, y sus días si se repite).
    /// Sin hora, devuelve nil y se quitan todas como antes.
    static func quitarUna(_ t: String, todas: [UNNotificationRequest], ahora: Date, c: UNUserNotificationCenter) -> String? {
        guard let r = Recordar.grupos(#"\b(?:de|a) (las? \d.*)$"#, t),
              let w = Recordar.cuando("a " + r[1], ahora: ahora, dia: "") else { return nil }
        let cal = Calendar.current
        let h = cal.component(.hour, from: w.0), m = cal.component(.minute, from: w.0)
        var horas: [String: (Int, Int)] = [:]
        for q in todas where q.identifier.hasSuffix("-a") {
            guard let d = (q.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate() else { continue }
            horas[q.content.threadIdentifier] = (cal.component(.hour, from: d), cal.component(.minute, from: d))
        }
        var hilos = Set(horas.filter { $0.value == (h, m) }.keys)
        // «la de las 7» sin decir mañana o tarde: vale la de las 7 o la de las 19
        if hilos.isEmpty { hilos = Set(horas.filter { $0.value.0 % 12 == h % 12 && $0.value.1 == m }.keys) }
        let f = hm
        guard !hilos.isEmpty else { return "No tiene ninguna alarma a las \(f.string(from: w.0)). Pregúnteme qué alarmas tiene." }
        c.removePendingNotificationRequests(withIdentifiers: todas.filter { hilos.contains($0.content.threadIdentifier) }.map { $0.identifier })
        let par = hilos.first.flatMap { horas[$0] } ?? (h, m)
        let dicha = String(format: "%d:%02d", par.0, par.1)
        return hilos.count == 1 ? "Quitada la alarma de las \(dicha). Las demás siguen puestas." : "Quitadas \(hilos.count) alarmas a esa hora."
    }

    // MARK: 0.58.0

    /// 0.58.0 (resta, condición nº 4): un solo formato «7:05» para todas las alarmas, en vez de uno en cada función.
    static let hm: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_ES")
        f.dateFormat = "H:mm"
        return f
    }()

    /// 0.58.0 (asistente): «despiértame como siempre», «pon la alarma de siempre» (también el control del Centro de control).
    /// Usa la última hora de despertarse que me dijo; si no la sé, se la pregunto.
    static let siempre = ["despiertame como siempre", "despierteme como siempre", "despiertame a la hora de siempre",
                          "pon la alarma de siempre", "ponme la alarma de siempre", "la alarma de siempre", "alarma de siempre",
                          "pon la alarma como siempre", "alarma como siempre"]

    static func deSiempre(_ t: String, ahora: Date) async -> String? {
        guard siempre.contains(t) else { return nil }
        guard let hora = UserDefaults.standard.string(forKey: ultimaKey) else {
            return "Aún no sé a qué hora se levanta. Dígame «despiértame a las 7» y me la aprendo."
        }
        return await quick("despiertame a las \(hora)", ahora: ahora)
    }

    /// 0.58.0 (asistente): «cuánto falta para mi alarma», «cuándo suena la alarma». La próxima, sea cual sea.
    static func cuantoFalta(_ t: String, ahora: Date, c: UNUserNotificationCenter) async -> String? {
        guard ["cuanto falta", "cuanto queda", "cuanto me queda", "cuando suena", "cuando me despiertas", "cuando sonara"]
                .contains(where: { t.hasPrefix($0) }) else { return nil }
        let proxima = await c.pendingNotificationRequests()
            .filter { $0.identifier.hasPrefix("alarm-") && !$0.identifier.hasSuffix("-b") }
            .compactMap { r -> Date? in
                if let k = r.trigger as? UNCalendarNotificationTrigger { return k.nextTriggerDate() }
                return (r.trigger as? UNTimeIntervalNotificationTrigger)?.nextTriggerDate()
            }
            .filter { $0 > ahora }
            .min()
        guard let d = proxima else { return "No tiene ninguna alarma puesta." }
        let s = d.timeIntervalSince(ahora)
        let falta = s < 60 ? "menos de un minuto" : Temporizadores.resto((s / 60).rounded(.up) * 60)
        let verbo = falta.hasPrefix("1 ") || falta.hasPrefix("menos") ? "Falta" : "Faltan"
        return "\(verbo) \(falta) para su alarma \(Recordar.dicho(d, ahora: ahora))."
    }

    // MARK: 0.56.0

    static let categoria = "arana.alarma"
    static let ultimaKey = "arana.alarma.ultima", propKey = "arana.alarma.propuesta"

    /// Los botones del aviso de la alarma: «Posponer 10 min» y «Apagar».
    static func registrarBotones() {
        let pos = UNNotificationAction(identifier: "posponer", title: "Posponer 10 min", options: [])
        let apa = UNNotificationAction(identifier: "apagar", title: "Apagar", options: [.destructive])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: categoria, actions: [pos, apa], intentIdentifiers: [], options: [])
        ])
    }

    /// 0.56.0 (asistente): lo que hace cada botón del aviso, sin abrir la app.
    /// Apagar o posponer quita la insistencia de los cinco minutos (en las que se repiten, la semana sigue igual).
    static func boton(_ accion: String, id: String, hilo: String) async {
        guard id.hasPrefix("alarm-"), accion == "posponer" || accion == "apagar" else { return }
        let c = UNUserNotificationCenter.current()
        c.removePendingNotificationRequests(withIdentifiers: [hilo + "-b"])
        c.removeDeliveredNotifications(withIdentifiers: [id])
        guard accion == "posponer" else { return }
        let n = UNMutableNotificationContent()
        n.title = "Araña · alarma"
        n.body = "Ya han pasado diez minutos. Arriba."
        n.sound = .default
        n.threadIdentifier = hilo
        n.categoryIdentifier = categoria
        try? await c.add(UNNotificationRequest(identifier: "\(hilo)-p\(Int(Date().timeIntervalSince1970))", content: n,
                                               trigger: UNTimeIntervalNotificationTrigger(timeInterval: 600, repeats: false)))
    }

    /// 0.56.0 (iniciativa): en «buenas noches», si no tiene alarma para mañana, le propongo la de la última vez.
    /// Solo pregunto: no pongo nada hasta que diga «sí».
    static func propuesta(ahora: Date = Date()) async -> String? {
        let d = UserDefaults.standard
        guard let hora = d.string(forKey: ultimaKey) else { return nil }
        let limite = ahora.addingTimeInterval(16 * 3600)
        let hay = await UNUserNotificationCenter.current().pendingNotificationRequests().contains { r in
            guard r.identifier.hasPrefix("alarm-"), let t = (r.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate() else { return false }
            return t < limite
        }
        guard !hay else { return nil }
        d.set(["hora": hora, "t": ahora.timeIntervalSince1970], forKey: propKey)
        return "No tiene alarma para mañana. ¿Le despierto a las \(hora), como la última vez? Dígame «sí» o «no»."
    }

    /// La respuesta a esa pregunta, durante los diez minutos siguientes.
    static func contestar(_ t: String, ahora: Date = Date()) async -> String? {
        let d = UserDefaults.standard
        guard let p = d.dictionary(forKey: propKey), let hora = p["hora"] as? String, let ts = p["t"] as? Double else { return nil }
        guard ahora.timeIntervalSince1970 - ts < 600 else { d.removeObject(forKey: propKey); return nil }
        let si = ["si", "vale", "si por favor", "si gracias", "de acuerdo", "venga", "claro", "por favor", "ponla"]
        let no = ["no", "no gracias", "mejor no", "ahora no", "no hace falta"]
        guard si.contains(t) || no.contains(t) else { return nil }
        d.removeObject(forKey: propKey)
        if no.contains(t) { return "Como usted diga. Mañana sin alarma." }
        return await quick("despiertame a las \(hora)", ahora: ahora) ?? "No he podido poner la alarma."
    }
}
