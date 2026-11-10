import ActivityKit
import AppIntents
import Foundation
import UserNotifications

/// 0.54.0 (h8): el botón «Parar» del temporizador en la Isla Dinámica y en la pantalla bloqueada.
/// Quita el aviso de ese temporizador y lo saca de la Isla, sin abrir la app.
/// Lo comparten la app y su extensión; iOS lo ejecuta en la app.
struct PararTemporizadorIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Parar el temporizador"
    static var description = IntentDescription("Cancela el temporizador que se ve en la Isla.")

    /// Cuándo acaba (segundos desde 1970): así sé qué temporizador es.
    @Parameter(title: "Fin")
    var fin: Double

    init() { fin = 0 }
    init(fin: Date) { self.fin = fin.timeIntervalSince1970 }

    func perform() async throws -> some IntentResult {
        await Parar.temporizador(fin: Date(timeIntervalSince1970: fin))
        return .result()
    }
}

/// 0.60.0 (h8): «Silencio» apaga el sonido para dormir desde la Isla o la pantalla bloqueada, sin abrir la app.
struct PararRuidoIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Apagar el sonido para dormir"
    static var description = IntentDescription("Apaga la lluvia o el ruido blanco de la araña.")

    init() {}

    func perform() async throws -> some IntentResult {
        // iOS lo ejecuta en la app, que es la que suena: allí `Ruido` escucha este aviso
        NotificationCenter.default.post(name: Parar.ruidoAviso, object: nil)
        for a in Activity<AranaAttributes>.activities where a.content.state.ruido == true {
            await a.end(nil, dismissalPolicy: .immediate)
        }
        return .result()
    }
}

enum Parar {
    static let ruidoAviso = Notification.Name("arana.pararRuido")

    /// Quita el aviso «timer-…» que suena a esa hora (con 5 s de margen) y cierra su actividad.
    static func temporizador(fin: Date) async {
        let c = UNUserNotificationCenter.current()
        let ids = await c.pendingNotificationRequests()
            .filter { r in
                guard r.identifier.hasPrefix("timer-") else { return false }
                if let f = r.content.userInfo["fin"] as? Double { return abs(f - fin.timeIntervalSince1970) < 5 }
                guard let d = (r.trigger as? UNTimeIntervalNotificationTrigger)?.nextTriggerDate() else { return false }
                return abs(d.timeIntervalSince(fin)) < 5
            }
            .map { $0.identifier }
        if !ids.isEmpty { c.removePendingNotificationRequests(withIdentifiers: ids) }
        for a in Activity<AranaAttributes>.activities {
            guard let f = a.content.state.fin, abs(f.timeIntervalSince(fin)) < 1 else { continue }
            let e = AranaAttributes.ContentState(estado: "Parado", paso: a.content.state.paso + 1)
            await a.end(ActivityContent(state: e, staleDate: nil), dismissalPolicy: .immediate)
        }
    }
}
