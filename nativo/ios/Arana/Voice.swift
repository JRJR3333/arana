import AVFoundation

/// La voz de la araña.
@MainActor
final class Voice {
    static let shared = Voice()
    private let synth = AVSpeechSynthesizer()

    func say(_ text: String) {
        synth.stopSpeaking(at: .immediate)
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "es-ES")
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 1.03
        synth.speak(u)
    }
}
