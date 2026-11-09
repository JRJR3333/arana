import AVFoundation

/// 0.59.0 (h7, condición «de noche»): sonido para dormir hecho en el propio iPhone, sin archivos ni internet.
/// «pon ruido para dormir», «sonido de lluvia 20 minutos», «ruido blanco», «quita el ruido».
/// Ruido marrón (suave, como lluvia) o blanco; se apaga solo bajando poco a poco (30 min si no se dice).
/// Sigue con la pantalla bloqueada gracias al modo de fondo «audio» que ya tenía la sala de ajedrez.
@MainActor
final class Ruido {
    static let shared = Ruido()
    private var engine: AVAudioEngine?
    private var fin: Task<Void, Never>?
    private let estado = Estado()

    /// Lo que lee el hilo de audio: volumen y tipo. Escrituras sueltas de Float/Bool, sin bloqueos.
    final class Estado: @unchecked Sendable {
        var volumen: Float = 0
        var blanco = false
        var marron: Float = 0
    }

    var sonando: Bool { engine?.isRunning == true }

    func empezar(minutos: Int, blanco: Bool) -> Bool {
        parar()
        estado.blanco = blanco
        estado.volumen = 0
        let e = AVAudioEngine()
        let fmt = e.outputNode.inputFormat(forBus: 0)
        let st = estado
        let fuente = AVAudioSourceNode { _, _, frames, lista -> OSStatus in
            let bufs = UnsafeMutableAudioBufferListPointer(lista)
            let g = st.volumen
            for i in 0..<Int(frames) {
                let w = Float.random(in: -1...1)
                var s: Float
                if st.blanco { s = w * 0.25 } else {
                    st.marron = (st.marron + w * 0.02) * 0.998
                    s = st.marron * 2.5
                }
                s *= g
                for b in bufs { b.mData?.assumingMemoryBound(to: Float.self)[i] = s }
            }
            return noErr
        }
        e.attach(fuente)
        e.connect(fuente, to: e.mainMixerNode, format: AVAudioFormat(standardFormatWithSampleRate: fmt.sampleRate, channels: 1))
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
            try e.start()
        } catch { return false }
        engine = e
        let total = Double(max(1, min(minutos, 600)) * 60)
        fin = Task { [weak self] in
            // Entra en 5 s, se mantiene y en el último minuto (o la última quinta parte) se apaga poco a poco
            let bajada = min(60, total / 5)
            await self?.rampa(de: 0, a: 0.6, segundos: 5)
            try? await Task.sleep(nanoseconds: UInt64(max(0, total - 5 - bajada) * 1e9))
            guard !Task.isCancelled else { return }
            await self?.rampa(de: 0.6, a: 0, segundos: bajada)
            guard !Task.isCancelled else { return }
            self?.parar()
        }
        return true
    }

    private func rampa(de a0: Float, a a1: Float, segundos: Double) async {
        let pasos = max(1, Int(segundos * 10))
        for k in 0...pasos {
            if Task.isCancelled { return }
            estado.volumen = a0 + (a1 - a0) * Float(k) / Float(pasos)
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    func parar() {
        fin?.cancel(); fin = nil
        guard let e = engine else { return }
        e.stop(); engine = nil
        estado.volumen = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /// Respuesta local si la frase es del sonido para dormir; nil si no.
    func quick(_ t: String) -> String? {
        let pide = ["ruido para dormir", "sonido para dormir", "ruido blanco", "ruido marron", "ruido rosa",
                    "sonido de lluvia", "ruido de lluvia", "pon lluvia", "sonido relajante", "algo para dormir"].contains { t.contains($0) }
        let quita = ["quita el ruido", "para el ruido", "apaga el ruido", "quita la lluvia", "para la lluvia",
                     "apaga la lluvia", "quita el sonido", "para el sonido", "apaga el sonido"].contains { t.contains($0) }
        guard t.count < 60 else { return nil }
        if quita {
            guard sonando else { return nil }
            parar(); return "Silencio. Que descanse."
        }
        guard pide, !["quita", "para ", "apaga"].contains(where: { t.hasPrefix($0) }) else { return nil }
        let n = t.split(whereSeparator: { !$0.isNumber }).compactMap { Int($0) }.first
        let mins = (t.contains(" hora") && !t.contains(" ahora")) || t.contains("horas") ? (n ?? 1) * 60 : (n ?? 30)
        let blanco = t.contains("blanco")
        guard empezar(minutos: mins, blanco: blanco) else { return "Ahora no puedo poner sonido." }
        let dura = mins % 60 == 0 && mins >= 60 ? (mins == 60 ? "una hora" : "\(mins / 60) horas") : "\(mins) minutos"
        return (blanco ? "Ruido blanco" : "Lluvia suave") + " durante \(dura); luego se apaga solo. Diga «quita el ruido» para pararlo antes."
    }
}
