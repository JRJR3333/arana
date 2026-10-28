import Foundation

/// 0.47.0 (asistente): «qué es la fotosíntesis», «quién fue Cervantes». Lo contesta Wikipedia en español:
/// gratis, sin clave y sin gastar API. Si no encuentra nada claro, devuelve nil y sigue el cerebro.
enum Wiki {
    static let entradas = ["que es ", "que son ", "quien es ", "quien fue ", "quien era ", "quienes son ",
                           "quienes fueron ", "que significa ", "que fue ", "que era "]
    static let articulos = ["un ", "una ", "el ", "la ", "los ", "las ", "lo "]
    static let personales: Set<String> = ["tu", "te", "ti", "tus", "mi", "me", "mis", "yo", "eso", "esto", "esta", "este", "aquello"]

    /// El tema de la pregunta, con sus tildes, o nil si no es una pregunta de «qué es / quién es».
    /// `t` llega en minúsculas y sin tildes; `original` es lo que dijo Juan.
    static func tema(_ t: String, original: String) -> String? {
        var s = t
        for p in ["oye ", "arana ", "sabes ", "dime ", "me dices "] where s.hasPrefix(p) { s = String(s.dropFirst(p.count)) }
        guard let e = entradas.first(where: { s.hasPrefix($0) }) else { return nil }
        s = String(s.dropFirst(e.count))
        if let a = articulos.first(where: { s.hasPrefix($0) }) { s = String(s.dropFirst(a.count)) }
        let palabras = s.split(separator: " ")
        guard (1...6).contains(palabras.count), !palabras.contains(where: { personales.contains(String($0)) }) else { return nil }
        // Las mismas últimas palabras, pero como las dijo Juan (con tildes)
        let limpio = original.components(separatedBy: CharacterSet(charactersIn: "¿?¡!.,;:«»\""))
            .joined(separator: " ").split(separator: " ")
        return limpio.count >= palabras.count ? limpio.suffix(palabras.count).joined(separator: " ") : palabras.joined(separator: " ")
    }

    /// Una o dos frases del resumen de Wikipedia, o nil.
    static func buscar(_ tema: String) async -> String? {
        var c = URLComponents(string: "https://es.wikipedia.org/w/rest.php/v1/search/title")!
        c.queryItems = [URLQueryItem(name: "q", value: tema), URLQueryItem(name: "limit", value: "1")]
        guard let u1 = c.url,
              let o1 = await json(u1),
              let paginas = o1["pages"] as? [[String: Any]],
              let clave = (paginas.first?["key"] ?? paginas.first?["title"]) as? String,
              let titulo = clave.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?"))),
              let u2 = URL(string: "https://es.wikipedia.org/api/rest_v1/page/summary/\(titulo)?redirect=true"),
              let o2 = await json(u2),
              (o2["type"] as? String) != "disambiguation",
              let extracto = o2["extract"] as? String, !extracto.isEmpty else { return nil }
        return resumen(extracto)
    }

    /// Quita los paréntesis y se queda con dos frases, como mucho unas 330 letras.
    static func resumen(_ texto: String) -> String {
        var s = texto.replacingOccurrences(of: "\\s*\\([^()]*\\)", with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        var frases: [String] = []
        s.enumerateSubstrings(in: s.startIndex..., options: [.bySentences, .localized]) { f, _, _, stop in
            if let f { frases.append(f.trimmingCharacters(in: .whitespaces)) }
            if frases.count == 2 { stop = true }
        }
        var r = frases.isEmpty ? s : frases.joined(separator: " ")
        if r.count > 330 { r = String(r.prefix(327)) + "…" }
        return r
    }

    /// Lo que la app contesta, o nil para que siga el cerebro.
    static func responder(_ t: String, original: String) async -> String? {
        guard let tema = tema(t, original: original), let r = await buscar(tema) else { return nil }
        return r + " (Wikipedia)"
    }

    private static func json(_ url: URL) async -> [String: Any]? {
        var req = URLRequest(url: url)
        req.timeoutInterval = 7
        req.setValue("Arana/0.47 (app personal de Juan; github.com/JRJR3333/arana)", forHTTPHeaderField: "User-Agent")
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}
