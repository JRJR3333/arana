import SwiftUI
import UserNotifications

@main
struct AranaApp: App {
    init() { UNUserNotificationCenter.current().delegate = Avisos.shared }
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
    }
}
