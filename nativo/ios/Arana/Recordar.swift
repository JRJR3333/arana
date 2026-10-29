import Foundation

/// 0.48.0 (h7): «recuérdame a las 18:30 llamar a mamá», «recuérdame mañana a las 9 ir al médico»,
/// «recuérdame en 20 minutos sacar la ropa» y «pon un temporizador de 10 minutos»: lo entiendo en local,
/// sin gastar API. El recordatorio va a Recordatorios con su alarma a esa hora; el temporizador, como siempre.
enum Recordar {
    /// El paso que hay que hacer y lo que digo si sale bien.
    static func paso(_ t: String, original: String, ahora: Date = Date()) -> (Step, String)? {
        if let p = temporizador(t) { return p }
        guard let r = grupos(#"^(?:oye |arana )?(?:recuerdame|recuerdeme|avisame|aviseme|acuerdate de avisarme|no me dejes olvidar)\b ?(.*)$"#, t) else { return nil }
        // «de la mañana» es la hora; «mañana» suelto, el día
        var x = " " + r[1].replacingOccurrences(of: "de la manana", with: "de la madrugada") + " "
        var dia = ""
        for d in ["pasado manana", "manana"] where x.contains(" \(d) ") {
            dia = d; x = x.replacingOccurrences(of: " \(d) ", with: " "); break
        }
        guard let w = cuando(x.trimmingCharacters(in: .whitespaces), ahora: ahora, dia: dia) else { return nil }
        let fecha = w.0, trozo = w.1
        var q = x.replacingOccurrences(of: " \(trozo) ", with: " ")
            .split(separator: " ").joined(separator: " ")
        for p in ["de que ", "que ", "de ", "a ", "para "] where q.hasPrefix(p) { q = String(q.dropFirst(p.count)); break }
        for p in [" por favor", " porfa"] where q.hasSuffix(p) { q = String(q.dropLast(p.count)) }
        guard q.count >= 2 else { return nil }
        q = conTildes(q, original: original)
        q = q.prefix(1).uppercased() + q.dropFirst()
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd'T'HH:mm"
        let step = Step(type: "reminder", text: q, when: f.string(from: fecha))
        return (step, "Apuntado en Recordatorios: \(q), \(dicho(fecha, ahora: ahora)). Le avisaré aunque la app esté cerrada.")
    }

    /// «pon un temporizador de 10 minutos», «avísame en 5 minutos» (sin decir de qué).
    static func temporizador(_ t: String) -> (Step, String)? {
        guard let r = grupos(#"^(?:pon(?:me)? |programa )?(?:un )?(?:temporizador|cuenta atras)(?: de)? (\d{1,3}|un|una|media) (segundos?|minutos?|min|horas?)$|^avisame en (\d{1,3}|un|una|media) (segundos?|minutos?|min|horas?)$"#, t) else { return nil }
        let n = r[1].isEmpty ? r[3] : r[1], u = r[1].isEmpty ? r[4] : r[2]
        let v: Double = n == "media" ? 0.5 : n.hasPrefix("un") ? 1 : Double(n) ?? 0
        let segs = Int(v * (u.hasPrefix("h") ? 3600 : u.hasPrefix("s") ? 1 : 60))
        guard segs > 0 else { return nil }
        let dicho = segs >= 3600 && segs % 3600 == 0 ? "\(segs / 3600) hora\(segs == 3600 ? "" : "s")"
            : segs >= 60 ? "\(segs / 60) minuto\(segs / 60 == 1 ? "" : "s")" + (segs % 60 > 0 ? " y \(segs % 60) segundos" : "")
            : "\(segs) segundos"
        return (Step(type: "timer", text: "Su temporizador", minutes: segs / 60, seconds: segs % 60), "Temporizador de \(dicho). Le aviso al terminar.")
    }

    /// «en 20 minutos», «en media hora», «a las 6», «a las 18:30», «a las 9 y media de la noche».
    static func cuando(_ l: String, ahora: Date, dia: String) -> (Date, String)? {
        if let m = grupos(#"\ben (\d{1,3}|un|una|media) (minutos?|min|horas?)\b"#, l) {
            let n: Double = m[1] == "media" ? 0.5 : m[1].hasPrefix("un") ? 1 : Double(m[1]) ?? 0
            let s = n * (m[2].hasPrefix("h") || m[1] == "media" ? 3600 : 60)
            return s > 0 ? (ahora.addingTimeInterval(s), m[0]) : nil
        }
        guard let m = grupos(#"\ba las? (\d{1,2})(?:(?: y |:| |h)(\d{2}|media|cuarto)| (menos cuarto))?(?: (?:de la )?(madrugada|tarde|noche))?\b"#, l) else { return nil }
        var h = Int(m[1]) ?? -1
        var mi = m[2] == "media" ? 30 : m[2] == "cuarto" ? 15 : Int(m[2]) ?? 0
        if !m[3].isEmpty { h -= 1; mi = 45 }
        guard (0...23).contains(h), (0...59).contains(mi) else { return nil }
        let per = m[4]
        if (per == "tarde" || per == "noche") && h < 12 { h += 12 }
        let cal = Calendar.current
        guard var d = cal.date(bySettingHour: h, minute: mi, second: 0, of: ahora) else { return nil }
        if dia == "manana" { d = cal.date(byAdding: .day, value: 1, to: d) ?? d }
        else if dia == "pasado manana" { d = cal.date(byAdding: .day, value: 2, to: d) ?? d }
        else if d <= ahora {
            // «a las 6» dicho a las tres de la tarde son las 18:00; si no, mañana
            let tarde = d.addingTimeInterval(12 * 3600)
            d = per.isEmpty && h < 12 && tarde > ahora ? tarde : cal.date(byAdding: .day, value: 1, to: d) ?? d
        }
        return d > ahora ? (d, m[0]) : nil
    }

    /// «hoy a las 18:00», «mañana a las 9:30», «el viernes a las 10:00».
    static func dicho(_ d: Date, ahora: Date) -> String {
        let cal = Calendar.current
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_ES")
        f.dateFormat = "H:mm"
        let hora = "a las " + f.string(from: d)
        if cal.isDate(d, inSameDayAs: ahora) { return "hoy " + hora }
        if let m = cal.date(byAdding: .day, value: 1, to: ahora), cal.isDate(d, inSameDayAs: m) { return "mañana " + hora }
        f.dateFormat = "EEEE d"
        return "el " + f.string(from: d) + " " + hora
    }

    /// El texto con sus tildes, si lo encuentro tal cual en la frase original.
    static func conTildes(_ q: String, original: String) -> String {
        let es = Locale(identifier: "es_ES")
        let orig = Array(original)
        let plano = orig.map { String($0).lowercased().folding(options: .diacriticInsensitive, locale: es) }
        guard plano.allSatisfy({ $0.count == 1 }) else { return q }
        let p = Array(plano.joined()), b = Array(q)
        guard b.count <= p.count else { return q }
        for i in 0...(p.count - b.count) where Array(p[i..<(i + b.count)]) == b {
            return String(orig[i..<(i + b.count)])
        }
        return q
    }

    /// Los grupos de la primera coincidencia (vacíos si no participan).
    static func grupos(_ patron: String, _ s: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: patron),
              let x = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<x.numberOfRanges).map { i in
            guard let r = Range(x.range(at: i), in: s) else { return "" }
            return String(s[r])
        }
    }
}
