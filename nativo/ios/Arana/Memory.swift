import Foundation

/// La memoria de la araña: sigue el hilo de la conversación y recuerda lo que Juan le cuenta de sí mismo.
/// Gastar poco: solo los 3 últimos intercambios, recortados, y como mucho 20 datos sueltos.
enum Memory {
    private static let d = UserDefaults.standard
    private static let kHist = "arana.historial"
    private static let kFacts = "arana.datos"
    static let maxTurns = 3
    static let maxFacts = 30

    /// Mensajes previos en formato de la API (alternan user / assistant).
    static var history: [[String: String]] {
        (d.array(forKey: kHist) as? [[String: String]]) ?? []
    }

    static var facts: [String] {
        d.stringArray(forKey: kFacts) ?? []
    }

    static func addTurn(user: String, reply: String) {
        var h = history
        h.append(["role": "user", "content": String(user.prefix(300))])
        h.append(["role": "assistant", "content": String(reply.prefix(300))])
        d.set(Array(h.suffix(maxTurns * 2)), forKey: kHist)
    }

    static func remember(_ fact: String) {
        let f = fact.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !f.isEmpty else { return }
        var all = facts.filter { $0.lowercased() != f.lowercased() }
        all.append(String(f.prefix(160)))
        d.set(Array(all.suffix(maxFacts)), forKey: kFacts)
    }

    /// 0.31.0: «olvida que…». true si había algo que borrar.
    static func forget(containing q: String) -> Bool {
        let n = { (x: String) in x.lowercased().folding(options: .diacriticInsensitive, locale: Locale(identifier: "es_ES")) }
        let quedan = facts.filter { !n($0).contains(n(q)) }
        guard quedan.count < facts.count, !q.isEmpty else { return false }
        d.set(quedan, forKey: kFacts)
        return true
    }

    /// Las órdenes cumplidas tejen la telaraña de fondo.
    static func addThread() { d.set(d.integer(forKey: "arana.hilos") + 1, forKey: "arana.hilos") }
}
