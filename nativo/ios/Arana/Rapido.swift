import Foundation

/// 0.21.0: respuestas al instante, en local y sin gastar API: hora, fecha, cuentas y días que faltan.
/// La sorpresa (dado, moneda, número al azar) va aparte en `azar` y se quita sin romper nada.
enum Rapido {
    static let es = Locale(identifier: "es_ES")

    /// `t` llega en minúsculas, sin tildes ni signos al principio o al final.
    static func responder(_ t: String, ahora: Date = Date()) -> String? {
        if let r = azar(t) { return r }
        if t.count > 60 { return nil }
        if ["que hora es", "que hora tienes", "dime la hora", "hora"].contains(t) || t.hasPrefix("que hora es") {
            return "Son las \(ahora.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(es)))."
        }
        if ["que dia es hoy", "a que dia estamos", "que fecha es hoy", "que dia es", "fecha de hoy", "en que dia estamos"].contains(t) {
            return "Hoy es \(ahora.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(es)))."
        }
        if let r = cuenta(t) { return r }
        if let r = faltan(t, ahora: ahora) { return r }
        return nil
    }

    /// «cuánto es 23 por 4», «12,5 más 3», «20 % de 80», «raíz de 81».
    static func cuenta(_ t: String) -> String? {
        var s = t
        for p in ["cuanto es ", "cuanto son ", "calcula ", "cuanto da "] where s.hasPrefix(p) { s = String(s.dropFirst(p.count)) }
        guard s != t || s.first?.isNumber == true else { return nil }
        let num = "(-?\\d+(?:[.,]\\d+)?)"
        func n(_ x: String) -> Double? { Double(x.replacingOccurrences(of: ",", with: ".")) }
        if let m = s.firstMatch(of: try! Regex("^\(num) ?(?:%|por ?ciento) de \(num)$")),
           let a = n(String(m.output[1].substring ?? "")), let b = n(String(m.output[2].substring ?? "")) {
            return "Son \(fmt(a * b / 100))."
        }
        if let m = s.firstMatch(of: try! Regex("^(?:la )?raiz(?: cuadrada)? de \(num)$")),
           let a = n(String(m.output[1].substring ?? "")), a >= 0 {
            return "Son \(fmt(a.squareRoot()))."
        }
        guard let m = s.firstMatch(of: try! Regex("^\(num) ?(mas|\\+|menos|-|por|x|\\*|entre|dividido entre|dividido por|/) ?\(num)$")),
              let a = n(String(m.output[1].substring ?? "")), let b = n(String(m.output[3].substring ?? "")) else { return nil }
        let op = String(m.output[2].substring ?? "")
        let r: Double
        switch op {
        case "mas", "+": r = a + b
        case "menos", "-": r = a - b
        case "por", "x", "*": r = a * b
        default:
            if b == 0 { return "Entre cero no se puede dividir." }
            r = a / b
        }
        return "Son \(fmt(r))."
    }

    /// «cuántos días faltan para navidad», «cuánto falta para el 15 de diciembre».
    static func faltan(_ t: String, ahora: Date) -> String? {
        guard t.hasPrefix("cuantos dias faltan para ") || t.hasPrefix("cuanto falta para ") || t.hasPrefix("cuantos dias quedan para ") else { return nil }
        let cal = Calendar.current
        let hoy = cal.startOfDay(for: ahora)
        let meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
        var dia = 0, mes = 0, nombre = ""
        if t.contains("navidad") { dia = 25; mes = 12; nombre = "Navidad" }
        else if t.contains("nochevieja") || t.contains("fin de ano") { dia = 31; mes = 12; nombre = "Nochevieja" }
        else if t.contains("reyes") { dia = 6; mes = 1; nombre = "Reyes" }
        else if let m = t.firstMatch(of: try! Regex("(\\d{1,2}) de ([a-z]+)")), let d = Int(m.output[1].substring ?? ""),
                let i = meses.firstIndex(of: String(m.output[2].substring ?? "")) {
            dia = d; mes = i + 1; nombre = "el \(d) de \(meses[i])"
        }
        guard mes > 0 else { return nil }
        var c = DateComponents(year: cal.component(.year, from: hoy), month: mes, day: dia)
        guard var meta = cal.date(from: c) else { return nil }
        if meta < hoy { c.year! += 1; meta = cal.date(from: c) ?? meta }
        let n = cal.dateComponents([.day], from: hoy, to: meta).day ?? 0
        return n == 0 ? "Es hoy." : n == 1 ? "Falta un día para \(nombre)." : "Faltan \(n) días para \(nombre)."
    }

    /// Sorpresa 0.21.0: el azar de la araña. «tira un dado», «cara o cruz», «un número del 1 al 50».
    static func azar(_ t: String) -> String? {
        if t.contains("tira un dado") || t == "dado" || t.contains("lanza un dado") {
            let d = Int.random(in: 1...6)
            return "Ha salido un \(d)." + (d == 6 ? " Buena mano." : "")
        }
        if t.contains("cara o cruz") || t.contains("lanza una moneda") || t.contains("tira una moneda") {
            return Bool.random() ? "Cara." : "Cruz."
        }
        if let m = t.firstMatch(of: try! Regex("numero (?:al azar )?del (\\d+) al (\\d+)")),
           let a = Int(m.output[1].substring ?? ""), let b = Int(m.output[2].substring ?? ""), a < b, b - a < 1_000_000 {
            return "El \(Int.random(in: a...b))."
        }
        return nil
    }

    static func fmt(_ x: Double) -> String {
        let f = NumberFormatter()
        f.locale = es
        f.maximumFractionDigits = 4
        f.minimumFractionDigits = 0
        return f.string(from: NSNumber(value: x)) ?? String(x)
    }
}
