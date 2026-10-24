import Foundation

/// 0.31.0 (#37): «recuerda que…», «olvida que…» y «qué sabes de mí», en local y sin gastar API.
/// También lo usa Siri («Recuerda en Araña») sin abrir la app.
enum Recuerdo {
    static let prefijos = ["quiero que recuerdes que ", "acuerdate de que ", "no olvides que ", "recuerda que ", "apunta que ", "anota que "]

    /// `t` llega normalizado (minúsculas, sin tildes); `original` conserva las tildes para guardarlo bonito.
    static func responder(_ t: String, original: String) -> String? {
        var n = t
        for p in ["oye ", "arana "] where n.hasPrefix(p) { n = String(n.dropFirst(p.count)) }
        for p in prefijos where n.hasPrefix(p) {
            let palabras = p.split(separator: " ").count + (t.count - n.count > 0 ? 1 : 0)
            let dato = original.split(separator: " ").dropFirst(palabras).joined(separator: " ")
            return apuntar(dato)
        }
        if n.hasPrefix("olvida que ") || n.hasPrefix("olvidate de que ") {
            let q = String(n.split(separator: " ").dropFirst(n.hasPrefix("olvida ") ? 2 : 3).joined(separator: " "))
            return Memory.forget(containing: q) ? "Olvidado." : "No tenía apuntado eso."
        }
        if ["que sabes de mi", "que recuerdas de mi", "que has apuntado", "que te he dicho"].contains(n) {
            return loQueSe()
        }
        return nil
    }

    /// 0.43.0: lo que tengo apuntado (también lo dice Siri sin abrir la app). Sin puntos dobles.
    static func loQueSe() -> String {
        let f = Memory.facts.suffix(6).map { $0.hasSuffix(".") ? String($0.dropLast()) : $0 }
        return f.isEmpty ? "Aún sé poco de usted. Dígame «recuerda que…» y lo apunto." : "Sé esto de usted: " + f.joined(separator: "; ") + "."
    }

    /// Guarda el dato y contesta. Devuelve nil si no había nada que guardar.
    static func apuntar(_ texto: String) -> String? {
        var d = texto.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: ".!?¡¿")))
        guard d.count >= 3 else { return nil }
        d = d.prefix(1).uppercased() + d.dropFirst()
        Memory.remember(d)
        return ["Apuntado: ", "Lo recordaré: ", "Guardado con hilo fino: "].randomElement()! + d + "."
    }
}
