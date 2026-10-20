import AudioToolbox
import Foundation

/// Sorpresa 0.20.0 (idea de la música): un metrónomo. «Metrónomo a 90» marca el compás; «para el metrónomo» lo quita.
/// Se puede quitar sin romper nada: solo lo usan Brain.quick y un botón de la pantalla.
@MainActor
final class Metronomo: ObservableObject {
    static let shared = Metronomo()
    @Published private(set) var bpm = 0
    private var timer: Timer?

    func start(_ b: Int) {
        stop()
        let v = min(240, max(30, b))
        bpm = v
        timer = Timer.scheduledTimer(withTimeInterval: 60.0 / Double(v), repeats: true) { _ in
            AudioServicesPlaySystemSound(1104)
        }
    }

    func stop() { timer?.invalidate(); timer = nil; bpm = 0 }

    /// Respuesta local si la frase es del metrónomo.
    func quick(_ t: String) -> String? {
        guard t.contains("metronomo") else { return nil }
        if ["para", "quita", "apaga", "basta", "detén", "deten"].contains(where: { t.contains($0) }) {
            stop(); return "Metrónomo parado."
        }
        let n = t.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }.first ?? 90
        start(n)
        return "Metrónomo a \(bpm). Diga «para el metrónomo» cuando acabe."
    }
}
