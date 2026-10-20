import Foundation
import Speech
import AVFoundation

/// El oído de la araña: su propio micrófono, sin pasar por el dictado del teclado.
/// Un toque empieza a escuchar; otro toque (o un silencio largo) termina y manda la orden.
@MainActor
final class Listener: ObservableObject {
    @Published var listening = false
    @Published var heard = ""
    /// Cuando termina de escuchar, deja aquí la frase completa para mandarla.
    @Published var done: String?

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "es-ES"))

    /// Devuelve un mensaje si no puede escuchar; nil si ya está escuchando.
    func start() async -> String? {
        let auth = await withCheckedContinuation { (c: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
            SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) }
        }
        guard auth == .authorized else { return "No tengo permiso para entender su voz. Actívelo en Ajustes → Araña." }
        guard await AVAudioApplication.requestRecordPermission() else { return "No tengo permiso para el micrófono. Actívelo en Ajustes → Araña." }
        guard let recognizer, recognizer.isAvailable else { return "Ahora no puedo entender voz. Pruebe en un momento." }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch { return "No puedo abrir el micrófono." }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        Self.tap(engine.inputNode, req)
        engine.prepare()
        do { try engine.start() } catch { engine.inputNode.removeTap(onBus: 0); return "No puedo abrir el micrófono." }

        heard = ""; done = nil; listening = true
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let end = error != nil || result?.isFinal == true
            Task { @MainActor in
                guard let self else { return }
                if let text { self.heard = text }
                if end { self.stop() }
            }
        }
        return nil
    }

    /// Deja de escuchar y entrega lo oído.
    func stop() {
        guard listening else { return }
        listening = false
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.finish()
        request = nil; task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        let t = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        if !t.isEmpty { done = t }
    }

    /// El grifo del micrófono corre fuera del hilo principal.
    nonisolated private static func tap(_ input: AVAudioInputNode, _ req: SFSpeechAudioBufferRecognitionRequest) {
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in req.append(buf) }
    }
}
