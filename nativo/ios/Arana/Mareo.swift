import UIKit

/// Sorpresa 0.42.0: si agita el iPhone, la araña se marea. Se quita borrando este archivo y su `.onReceive` en ContentView.
enum Mareo {
    static let aviso = Notification.Name("arana.mareo")
    static let frases = ["¡Quieto, que me mareo!", "Uy… veo tres telarañas.", "Así no hay quien teja, señor.", "Un momento, que se me cruzan las patas."]
}

extension UIWindow {
    open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake { NotificationCenter.default.post(name: Mareo.aviso, object: nil) }
        super.motionEnded(motion, with: event)
    }
}
