import SwiftUI
import UserNotifications
import AppIntents

@main
struct AranaApp: App {
    init() {
        UNUserNotificationCenter.current().delegate = Avisos.shared
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
}
