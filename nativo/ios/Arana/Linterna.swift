import AVFoundation

/// 0.49.0 (asistente, condición «de noche»): la linterna del iPhone, en local y sin gastar API.
/// «enciende la linterna», «apaga la linterna», «linterna» (cambia), «luz suave» o «linterna al 30».
/// No pide permiso de cámara: iOS deja usar la luz sin él.
enum Linterna {
    static func quick(_ t: String) -> String? {
        let suave = ["luz suave", "luz tenue", "linterna suave", "linterna flojita", "un poco de luz", "poca luz"].contains { t.contains($0) }
        guard suave || t.contains("linterna") || t.contains("flash") && t.count < 30 else { return nil }
        guard let d = AVCaptureDevice.default(for: .video), d.hasTorch, d.isTorchAvailable else {
            return "Ahora no puedo usar la linterna."
        }
        let apagar = ["apaga", "quita", "para", "fuera", "basta"].contains { t.contains($0) }
        let encender = suave || ["enciende", "pon", "abre", "dame", "activa", "luz"].contains { t.contains($0) }
        let nivel: Float? = suave ? 0.1 : porcentaje(t)
        do {
            try d.lockForConfiguration()
            defer { d.unlockForConfiguration() }
            if apagar || (!encender && nivel == nil && d.torchMode == .on) {
                d.torchMode = .off
                return "Linterna apagada."
            }
            let v = min(1, max(0.05, nivel ?? 1))
            try d.setTorchModeOn(level: v)
            return v < 1 ? "Luz suave encendida. Diga «apaga la linterna» cuando acabe." : "Linterna encendida."
        } catch {
            return "No he podido usar la linterna."
        }
    }

    /// «al 30», «al 30 por ciento», «a la mitad».
    static func porcentaje(_ t: String) -> Float? {
        if t.contains("mitad") { return 0.5 }
        guard let n = t.split(whereSeparator: { !$0.isNumber }).compactMap({ Int($0) }).first, n > 0, n <= 100 else { return nil }
        return Float(n) / 100
    }
}
