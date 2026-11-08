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

/// h8 (0.50.0): la luz suave a un toque, sin hablar. Útil de noche.
@available(iOS 18.0, *)
struct LuzControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.jrjr3333.arana.luz") {
            ControlWidgetButton(action: LuzSuaveIntent()) {
                Label("Luz suave", systemImage: "flashlight.on.fill")
            }
        }
        .displayName("Luz suave")
        .description("La araña enciende la linterna flojita, o la apaga.")
    }
}

/// h8 (0.55.0): un temporizador de 5 minutos a un toque (té, pasta, una pausa). Se ve en la Isla con su botón «Parar».
@available(iOS 18.0, *)
struct TemporizadorControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.jrjr3333.arana.temporizador") {
            ControlWidgetButton(action: TemporizadorRapidoIntent()) {
                Label("5 minutos", systemImage: "timer")
            }
        }
        .displayName("Temporizador 5 min")
        .description("La araña pone un temporizador de 5 minutos.")
    }
}

/// h8 (0.58.0): la alarma de siempre a un toque, antes de dormir. Sin hablar.
@available(iOS 18.0, *)
struct AlarmaControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.jrjr3333.arana.alarma") {
            ControlWidgetButton(action: AlarmaSiempreIntent()) {
                Label("Alarma de siempre", systemImage: "alarm")
            }
        }
        .displayName("Alarma de siempre")
        .description("La araña le pone la alarma a la hora de la última vez.")
    }
}
