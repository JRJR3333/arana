import SwiftUI
import UserNotifications
import AppIntents

@main
struct AranaApp: App {
    init() {
        UNUserNotificationCenter.current().delegate = Avisos.shared
        // 0.56.0 (asistente): «Posponer 10 min» y «Apagar» en el aviso de la alarma
        Alarmas.registrarBotones()
        // 0.42.0: que Siri vuelva a leer mis frases (ya en español) al abrir la app
        AranaShortcuts.updateAppShortcutParameters()
    }
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

/// Para que el temporizador suene también con la araña abierta.
final class Avisos: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Avisos()
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .list])
        // 0.52.0 (h8): el temporizador ha sonado; fuera de la Isla
        if notification.request.identifier.hasPrefix("timer-") { Task { @MainActor in Isla.limpiar() } }
    }
    /// 0.56.0 (asistente): los botones del aviso de la alarma.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let accion = response.actionIdentifier
        let id = response.notification.request.identifier
        let hilo = response.notification.request.content.threadIdentifier
        Task { @MainActor in
            await Alarmas.boton(accion, id: id, hilo: hilo)
            completionHandler()
        }
    }
}
