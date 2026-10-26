import AVFoundation

/// La voz de la araña.
/// 0.45.0 (h7, lo mismo que #50 en Android): «que su voz no sea tan robótica». Usa la voz más natural que
/// tenga el iPhone en español (Premium, luego Mejorada, luego la normal; de España si la hay) y, con
/// «otra voz», pasa a la siguiente y la recuerda.
@MainActor
final class Voice {
    static let shared = Voice()
    private let synth = AVSpeechSynthesizer()
    private let clave = "arana.voz"

    /// Las voces en español, de más natural a menos. Sin las voces de broma.
    static func espanolas() -> [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("es") && !$0.voiceTraits.contains(.isNoveltyVoice) }
            .sorted { a, b in
                if a.quality.rawValue != b.quality.rawValue { return a.quality.rawValue > b.quality.rawValue }
                let ae = a.language == "es-ES", be = b.language == "es-ES"
                if ae != be { return ae }
                return a.name < b.name
            }
    }

    private var voz: AVSpeechSynthesisVoice? {
        let vs = Self.espanolas()
        if let id = UserDefaults.standard.string(forKey: clave), let v = vs.first(where: { $0.identifier == id }) { return v }
        return vs.first ?? AVSpeechSynthesisVoice(language: "es-ES")
    }

    func say(_ text: String) {
        synth.stopSpeaking(at: .immediate)
        let u = AVSpeechUtterance(string: text)
        u.voice = voz
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 1.03
        synth.speak(u)
    }

    /// «otra voz»: la siguiente voz en español, y se queda con ella.
    func siguiente() -> String {
        let vs = Self.espanolas()
        guard vs.count > 1 else {
            return "Solo tengo una voz en español. En Ajustes → Accesibilidad → Contenido leído → Voces puede descargar una «Mejorada» o «Premium»: la usaré sola."
        }
        let actual = voz?.identifier
        let i = vs.firstIndex(where: { $0.identifier == actual }) ?? -1
        let v = vs[(i + 1) % vs.count]
        UserDefaults.standard.set(v.identifier, forKey: clave)
        let calidad = v.quality == .premium ? "premium" : v.quality == .enhanced ? "mejorada" : "normal"
        return "Ahora hablo como \(v.name), voz \(calidad). ¿Mejor así? Diga «otra voz» para cambiar."
    }
}
