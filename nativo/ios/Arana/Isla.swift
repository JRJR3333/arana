import ActivityKit
import Foundation

/// La araña en la Isla: se enciende al pensar y se apaga al terminar. Si Juan no la permite, no pasa nada.
@MainActor
enum Isla {
    private static var actual: Activity<AranaAttributes>?
    private static var orden = ""

    static func start(_ texto: String = "") {
        guard ActivityAuthorizationInfo().areActivitiesEnabled, actual == nil else { return }
        orden = String(texto.prefix(40))
        let estado = AranaAttributes.ContentState(estado: "Pensando…", paso: 0)
        actual = try? Activity.request(attributes: AranaAttributes(orden: orden),
                                       content: ActivityContent(state: estado, staleDate: Date().addingTimeInterval(60)))
    }

    static func end(_ estado: String = "Hecho") {
        guard let a = actual else { return }
        actual = nil
        let fin = AranaAttributes.ContentState(estado: estado, paso: 1)
        Task { await a.end(ActivityContent(state: fin, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(4))) }
    }
}
