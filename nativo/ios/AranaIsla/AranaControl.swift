import AppIntents
import SwiftUI
import WidgetKit

/// h8 (0.21.0): la araña en el Centro de control, en la pantalla bloqueada y en el botón de Acción (iOS 18).
@available(iOS 18.0, *)
struct AranaControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.jrjr3333.arana.control") {
            ControlWidgetButton(action: EscucharIntent()) {
                Label("Araña", systemImage: "mic.fill")
            }
        }
        .displayName("Araña")
        .description("Un toque y la araña le escucha.")
    }
}
