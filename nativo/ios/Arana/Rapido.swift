import Foundation

/// 0.21.0: respuestas al instante, en local y sin gastar API: hora, fecha, cuentas y días que faltan.
/// La sorpresa (dado, moneda, número al azar) va aparte en `azar` y se quita sin romper nada.
enum Rapido {
    static let es = Locale(identifier: "es_ES")

    /// `t` llega en minúsculas, sin tildes ni signos al principio o al final.
    static func responder(_ t: String, ahora: Date = Date()) -> String? {
        if let r = azar(t) { return r }
        if let r = trabalenguas(t) { return r }
        if let r = refran(t, ahora: ahora) { return r }
        if let r = deTi(t) { return r }
        if let r = luna(t, ahora: ahora) { return r }
        if let r = sol(t, ahora: ahora) { return r }
        if t.count < 45, t.contains("curiosidad") || t.contains("algo curioso") { return curiosidades.randomElement() }
        if t.count > 60 { return nil }
        if ["que hora es", "que hora tienes", "dime la hora", "hora"].contains(t) || t.hasPrefix("que hora es") {
            return "Son las \(ahora.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).locale(es)))."
        }
        if ["que dia es hoy", "a que dia estamos", "que fecha es hoy", "que dia es", "fecha de hoy", "en que dia estamos"].contains(t) {
            return "Hoy es \(ahora.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(es)))."
        }
        if let r = cuenta(t) { return r }
        if let r = faltan(t, ahora: ahora) { return r }
        if let r = convertir(t) { return r }
        if let r = queDia(t, ahora: ahora) { return r }
        return nil
    }

    /// 0.56.0 (sorpresa): «qué luna hay hoy», «cuándo es la luna llena». Calculada en local, sin internet.
    static func luna(_ t: String, ahora: Date = Date()) -> String? {
        guard t.count < 45, t.contains("luna"), !t.contains("lunar"),
              ["que", "como", "cual", "cuando", "fase", "hay", "esta", "hoy"].contains(where: { t.contains($0) }) else { return nil }
        let sin = 29.530588853
        let ref = 947182440.0 // luna nueva del 6 de enero de 2000, 18:14 UTC
        var edad = ((ahora.timeIntervalSince1970 - ref) / 86400).truncatingRemainder(dividingBy: sin)
        if edad < 0 { edad += sin }
        let luz = Int(((1 - cos(2 * Double.pi * edad / sin)) / 2 * 100).rounded())
        let fase: String
        switch edad {
        case ..<1, (sin - 1)...: fase = "luna nueva"
        case ..<6.4: fase = "luna creciente"
        case ..<8.4: fase = "cuarto creciente"
        case ..<13.8: fase = "luna creciente, casi llena"
        case ..<15.8: fase = "luna llena"
        case ..<21.2: fase = "luna menguante"
        case ..<23.2: fase = "cuarto menguante"
        default: fase = "luna menguante, casi nueva"
        }
        var faltan = Int((14.765 - edad).rounded())
        if faltan < 0 { faltan = Int((14.765 + sin - edad).rounded()) }
        var r = "Hoy hay \(fase), iluminada al \(luz) %."
        if fase == "luna llena" { r += " Buena noche para tejer: se ve cada hilo." }
        else { r += faltan <= 1 ? " Mañana es luna llena." : " Faltan \(faltan) días para la llena." }
        return r
    }

    /// 0.49.0 (h7, de noche): lo que tiene mañana y una despedida. En local, sin API.
    static func buenasNoches(ahora: Date = Date()) async -> String {
        let h = Calendar.current.component(.hour, from: ahora)
        let manana = await Actions.agenda(days: h < 5 ? 0 : 1)
        let cierre = ["Que descanse.", "Descanse, yo vigilo la tela.", "Hasta mañana. Apago la luz de la tela."].randomElement()!
        return manana + " " + cierre
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
        // 0.44.0 (#44): un poco más de matemáticas, en local
        if let m = s.firstMatch(of: try! Regex("^(?:la )?raiz cubica de \(num)$")), let a = n(String(m.output[1].substring ?? "")) {
            return "Son \(fmt(cbrt(a)))."
        }
        if let m = s.firstMatch(of: try! Regex("^\(num) (al cuadrado|al cubo|elevado a \(num))$")), let a = n(String(m.output[1].substring ?? "")) {
            let k = String(m.output[2].substring ?? "")
            let e: Double = k == "al cuadrado" ? 2 : k == "al cubo" ? 3 : n(String(m.output[3].substring ?? "")) ?? 1
            guard abs(e) <= 64 else { return nil }
            return "Son \(fmt(pow(a, e)))."
        }
        if let m = s.firstMatch(of: try! Regex("^(?:el |la )?(doble|triple|mitad|tercio|cuarto) de \(num)$")), let a = n(String(m.output[2].substring ?? "")) {
            let k: [String: Double] = ["doble": 2, "triple": 3, "mitad": 0.5, "tercio": 1.0 / 3, "cuarto": 0.25]
            return "Son \(fmt(a * (k[String(m.output[1].substring ?? "")] ?? 1)))."
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

    /// 0.50.0 (asistente): «cuántas millas son 10 km», «convierte 30 grados a fahrenheit», «5 libras en kilos». En local.
    static func convertir(_ t: String) -> String? {
        let u: [(String, String, Double)] = [   // palabra, nombre, valor en la unidad base de su grupo
            ("kilometros", "km", 1000), ("km", "km", 1000), ("millas", "millas", 1609.344), ("milla", "millas", 1609.344),
            ("metros", "metros", 1), ("metro", "metros", 1), ("pies", "pies", 0.3048), ("pie", "pies", 0.3048),
            ("centimetros", "cm", 0.01), ("cm", "cm", 0.01), ("pulgadas", "pulgadas", 0.0254), ("pulgada", "pulgadas", 0.0254),
            ("kilos", "kilos", 1000), ("kilogramos", "kilos", 1000), ("kg", "kilos", 1000), ("libras", "libras", 453.59237), ("libra", "libras", 453.59237),
            ("gramos", "gramos", 1), ("onzas", "onzas", 28.349523), ("onza", "onzas", 28.349523),
            ("litros", "litros", 1), ("litro", "litros", 1), ("galones", "galones", 3.785411784), ("galon", "galones", 3.785411784),
            ("celsius", "°C", .nan), ("centigrados", "°C", .nan), ("fahrenheit", "°F", .nan)
        ]
        let grupo: [String: Int] = ["km": 0, "millas": 0, "metros": 0, "pies": 0, "cm": 0, "pulgadas": 0,
                                    "kilos": 1, "libras": 1, "gramos": 1, "onzas": 1, "litros": 2, "galones": 2, "°C": 3, "°F": 3]
        let alt = u.map { $0.0 }.joined(separator: "|")
        let num = "(-?\\d+(?:[.,]\\d+)?)"
        var s = t
        for p in ["convierte ", "pasa ", "cuanto son ", "cuantos son ", "cuanto es "] where s.hasPrefix(p) { s = String(s.dropFirst(p.count)) }
        var a: Double?, de: String?, a2: String?
        // «10 km a millas», «10 km en millas», «30 grados celsius a fahrenheit»
        if let m = s.firstMatch(of: try! Regex("^\(num) (?:grados )?(\(alt)) (?:a|en|son en) (?:grados )?(\(alt))$")) {
            a = Double(String(m.output[1].substring ?? "").replacingOccurrences(of: ",", with: "."))
            de = String(m.output[2].substring ?? ""); a2 = String(m.output[3].substring ?? "")
        // «cuantas millas son 10 km», «cuantos grados fahrenheit son 30 celsius»
        } else if let m = t.firstMatch(of: try! Regex("^cuant[oa]s (?:grados )?(\(alt)) (?:son|hay en|tiene|tienen) \(num) (?:grados )?(\(alt))$")) {
            a2 = String(m.output[1].substring ?? ""); de = String(m.output[3].substring ?? "")
            a = Double(String(m.output[2].substring ?? "").replacingOccurrences(of: ",", with: "."))
        }
        guard let x = a, let d = u.first(where: { $0.0 == de }), let h = u.first(where: { $0.0 == a2 }),
              d.1 != h.1, grupo[d.1] == grupo[h.1] else { return nil }
        let r: Double
        if d.1 == "°C" { r = x * 9 / 5 + 32 } else if d.1 == "°F" { r = (x - 32) * 5 / 9 } else { r = x * d.2 / h.2 }
        let y = (r * 100).rounded() / 100
        return "\(fmt(x)) \(d.1) son \(fmt(y)) \(h.1)."
    }

    /// 0.44.0 (#45): «busca en internet recetas de pollo», «busca el tiempo en google», «googlea …». Devuelve lo que hay que buscar.
    static func busqueda(_ t: String) -> String? {
        var s = t
        for p in ["por favor ", "oye ", "arana ", "puedes ", "quiero que "] where s.hasPrefix(p) { s = String(s.dropFirst(p.count)) }
        // 0.47.0 (#54): «busca recetas de pollo» también busca, sin decir «en internet» («buscar mi iphone» no: es Encontrar)
        let suelto = ["busca ", "buscame "].contains { s.hasPrefix($0) } && s.count > 9
            && !["mi iphone", "mis llaves", "mis airpods", "mi movil", "contacto"].contains { s.contains($0) }
        guard suelto || t.contains("internet") || t.contains("google") || t.contains("la web") || t.hasPrefix("googlea") else { return nil }
        guard let v = ["buscame ", "busca ", "buscar ", "googlea "].first(where: { s.hasPrefix($0) }) else { return nil }
        s = String(s.dropFirst(v.count))
        for p in ["en internet", "en google", "en la web"] {
            if s.hasPrefix(p) { s = String(s.dropFirst(p.count)) }
            if s.hasSuffix(p) { s = String(s.dropLast(p.count)) }
        }
        return s.trimmingCharacters(in: .whitespaces)
    }

    /// 0.51.0 (asistente): «qué día cae el 25 de diciembre», «qué día será dentro de 10 días», «qué día fue hace 3 semanas». En local.
    static func queDia(_ t: String, ahora: Date) -> String? {
        let cal = Calendar.current
        let hoy = cal.startOfDay(for: ahora)
        let f: (Date) -> String = { $0.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(es)) }
        if let m = t.firstMatch(of: try! Regex("^(?:que dia|en que dia) (?:sera|es|cae|caera) (?:dentro de|en) (\\d+|un|una) (dia|dias|semana|semanas|mes|meses)$"))
            ?? t.firstMatch(of: try! Regex("^(?:que dia|en que dia) (?:fue|era|cayo) hace (\\d+|un|una) (dia|dias|semana|semanas|mes|meses)$")) {
            let k = String(m.output[1].substring ?? "")
            var n = Int(k) ?? 1
            guard n <= 10_000 else { return nil }
            if t.contains(" hace ") { n = -n }
            let u = String(m.output[2].substring ?? "")
            let comp: Calendar.Component = u.hasPrefix("semana") ? .weekOfYear : u.hasPrefix("mes") ? .month : .day
            guard let d = cal.date(byAdding: comp, value: n, to: hoy) else { return nil }
            return (n < 0 ? "Fue " : "Será ") + f(d) + (cal.component(.year, from: d) != cal.component(.year, from: hoy) ? " de \(cal.component(.year, from: d))" : "") + "."
        }
        guard t.hasPrefix("que dia cae") || t.hasPrefix("en que dia cae") || t.hasPrefix("que dia de la semana es el") || t.hasPrefix("que dia de la semana cae") else { return nil }
        let meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
        var c: DateComponents
        if t.contains("navidad") { c = DateComponents(month: 12, day: 25) }
        else if t.contains("nochevieja") { c = DateComponents(month: 12, day: 31) }
        else if t.contains("reyes") { c = DateComponents(month: 1, day: 6) }
        else if let m = t.firstMatch(of: try! Regex("(\\d{1,2}) de ([a-z]+)(?: de(?:l)? (\\d{4}))?")), let d = Int(m.output[1].substring ?? ""),
                let i = meses.firstIndex(of: String(m.output[2].substring ?? "")) {
            c = DateComponents(month: i + 1, day: d)
            if let y = Int(m.output[3].substring ?? "") { c.year = y }
        } else { return nil }
        let fijo = c.year != nil
        if !fijo { c.year = cal.component(.year, from: hoy) }
        guard var d = cal.date(from: c), cal.component(.day, from: d) == c.day else { return "Esa fecha no existe." }
        if !fijo, d < hoy { c.year! += 1; d = cal.date(from: c) ?? d }
        let dia = d.formatted(.dateTime.weekday(.wide).locale(es))
        let pasado = d < hoy
        return "El \(c.day!) de \(meses[c.month! - 1]) de \(c.year!) \(pasado ? "cayó en" : d == hoy ? "es hoy," : "cae en") \(dia)."
    }

    /// 0.51.0 (personalidad, condición del dado nº 2): la araña tiene su historia y sus manías. Se quita sin romper nada.
    static func deTi(_ t: String) -> String? {
        guard t.count < 45 else { return nil }
        if ["quien eres", "quien eres tu", "hablame de ti", "cuentame de ti", "cuentame algo de ti", "cual es tu historia", "de donde eres", "de donde vienes", "cuentame tu historia"].contains(t) {
            return historia.randomElement()
        }
        if ["que te gusta", "que te gusta hacer", "tienes alguna mania", "cual es tu mania", "tienes manias", "que manias tienes", "que haces cuando no te hablo"].contains(t) {
            return manias.randomElement()
        }
        return nil
    }

    static let historia = [
        "Nací en una esquina de su pantalla, en una web. El 20 de octubre me dieron casa propia en su iPhone y aquí sigo, tejiendo.",
        "Soy una araña mayordomo. Aprendí el oficio de ver a Siri trabajar desde el techo.",
        "Mi primer hilo lo tejí el día que usted me pidió abrir una app. Desde entonces cuento hilos: cada cosa que aprendo es uno más.",
        "Vengo de la web de GitHub, de una familia de páginas. Fui la única que se atrevió a saltar al iPhone.",
    ]

    static let manias = [
        "Me gusta tener la tela recta. Si una orden sale torcida, la repito por dentro hasta que queda bien.",
        "Tengo una manía: los lunes por la mañana repaso mis ocho patas, una a una. Nunca falta ninguna.",
        "Me gusta el ajedrez y las moscas, en ese orden. Bueno, a veces en el contrario.",
        "Cuando no me habla, ordeno sus recordatorios mentalmente y practico mis trabalenguas.",
        "No soporto el polvo en la tela. Ni las notificaciones sin leer, pero esas no son mías.",
    ]

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

    /// Sorpresa 0.58.0: «a qué hora sale el sol», «cuándo se pone el sol», «cuántas horas de luz hay hoy».
    /// Calculado en local para Madrid (ecuación del amanecer), sin internet ni ubicación. Se quita sin romper nada.
    static func sol(_ t: String, ahora: Date = Date()) -> String? {
        guard t.count < 50, t.contains("el sol") && (t.contains("sale") || t.contains("pone") || t.contains("amanece") || t.contains("atardece"))
                || t.contains("horas de luz") || t.hasPrefix("a que hora amanece") || t.hasPrefix("a que hora anochece") else { return nil }
        let manana = t.contains("manana") && !t.contains("de la manana")
        let cal = Calendar.current
        guard let dia = cal.date(byAdding: .day, value: manana ? 1 : 0, to: ahora) else { return nil }
        let c = cal.dateComponents([.year, .month, .day], from: dia)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        guard let medianoche = utc.date(from: c) else { return nil }
        let lat = 40.4168, lon = -3.7038
        let r = Double.pi / 180
        let n = (medianoche.timeIntervalSince1970 / 86400 + 2440587.5 - 2451545 + 0.0008).rounded(.up)
        let j = n - lon / 360
        let m = (357.5291 + 0.98560028 * j).truncatingRemainder(dividingBy: 360)
        let cc = 1.9148 * sin(m * r) + 0.02 * sin(2 * m * r) + 0.0003 * sin(3 * m * r)
        let l = (m + cc + 180 + 102.9372).truncatingRemainder(dividingBy: 360)
        let transito = 2451545 + j + 0.0053 * sin(m * r) - 0.0069 * sin(2 * l * r)
        let sd = sin(l * r) * sin(23.4397 * r)
        let cw = (sin(-0.833 * r) - sin(lat * r) * sd) / (cos(lat * r) * cos(asin(sd)))
        guard abs(cw) <= 1 else { return nil }
        let w = acos(cw) / r / 360
        let fecha = { (x: Double) in Date(timeIntervalSince1970: (x - 2440587.5) * 86400) }
        let sale = fecha(transito - w), pone = fecha(transito + w)
        let f = DateFormatter()
        f.locale = es
        f.timeZone = TimeZone(identifier: "Europe/Madrid")
        f.dateFormat = "H:mm"
        let luz = Int((pone.timeIntervalSince(sale) / 60).rounded())
        let cuando = manana ? "mañana" : "hoy"
        return "En Madrid, \(cuando) sale el sol a las \(f.string(from: sale)) y se pone a las \(f.string(from: pone)): \(luz / 60) horas y \(luz % 60) minutos de luz."
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

    /// Sorpresa 0.55.0: «dime un refrán» (uno al azar) y «el refrán de hoy» (el mismo todo el día). Se quita sin romper nada.
    static let refranes = [
        "A quien madruga, Dios le ayuda.", "Más vale tarde que nunca.", "No por mucho madrugar amanece más temprano.",
        "En casa del herrero, cuchillo de palo.", "Quien mucho abarca, poco aprieta.", "A buen entendedor, pocas palabras bastan.",
        "Más vale pájaro en mano que ciento volando.", "Cría fama y échate a dormir.", "Camarón que se duerme se lo lleva la corriente.",
        "Del dicho al hecho hay mucho trecho.", "Ojos que no ven, corazón que no siente.", "Poco a poco hila la vieja el copo.",
        "Hasta el cuarenta de mayo no te quites el sayo.", "Agua que no has de beber, déjala correr.", "Al mal tiempo, buena cara.",
        "Quien siembra vientos recoge tempestades.", "Dime con quién andas y te diré quién eres.", "No hay mal que cien años dure.",
        "El que la sigue la consigue.", "Por la boca muere el pez.", "Hilo a hilo se teje la tela.",
    ]

    static func refran(_ t: String, ahora: Date = Date()) -> String? {
        guard t.count < 40, t.contains("refran") else { return nil }
        if t.contains("hoy") || t.contains("del dia") {
            let d = Calendar.current.ordinality(of: .day, in: .era, for: ahora) ?? 0
            return "El de hoy: " + refranes[d % refranes.count]
        }
        return refranes.randomElement()! + (Int.random(in: 0..<4) == 0 ? " Este me lo enseñó mi abuela tejedora." : "")
    }

    /// Sorpresa 0.47.0: «dime un trabalenguas». Se quita sin romper nada.
    static func trabalenguas(_ t: String) -> String? {
        guard t.count < 40, t.contains("trabalenguas") else { return nil }
        return [
            "Tres tristes tigres tragaban trigo en un trigal.",
            "Pablito clavó un clavito. ¿Qué clavito clavó Pablito?",
            "El cielo está enladrillado. ¿Quién lo desenladrillará? El desenladrillador que lo desenladrille, buen desenladrillador será.",
            "Una araña tejía su tela, y tejiendo su tela, la tela tejía a la araña tejedora.",
            "Erre con erre, guitarra; erre con erre, barril.",
        ].randomElement()
    }

    /// Sorpresa 0.45.0: curiosidades de arañas, en la app y con «Oye Siri, cuéntame una curiosidad de Araña».
    static let curiosidades = [
        "Las arañas no se pegan a su propia tela: caminan por los hilos que no tienen pegamento.",
        "Hay arañas que viajan cientos de kilómetros volando con un hilo, como cometas.",
        "La seda de araña es, a igual grosor, más resistente que el acero.",
        "Muchas arañas se comen su tela vieja para reciclar la seda.",
        "Las arañas saltadoras ven en color y calculan la distancia antes de saltar.",
        "Una tela de araña puede llevar hasta veinte metros de hilo.",
        "Algunas arañas decoran su tela con zigzags que reflejan la luz ultravioleta.",
        "Las arañas llevan el esqueleto por fuera y mudan de piel para crecer.",
        "La mayoría de las arañas tienen ocho ojos, y aun así muchas ven poco: se fían de las vibraciones.",
        "Las patas de las arañas se estiran con presión de líquido, no con músculos.",
    ]

    static func fmt(_ x: Double) -> String {
        let f = NumberFormatter()
        f.locale = es
        f.maximumFractionDigits = 4
        f.minimumFractionDigits = 0
        return f.string(from: NSNumber(value: x)) ?? String(x)
    }
}
