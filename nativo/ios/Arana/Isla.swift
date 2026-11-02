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

    /// 0.52.0 (h8): el temporizador, con su cuenta atrás en la Isla y en la pantalla bloqueada.
    /// El aviso que suena es la notificación de siempre; esto solo lo enseña.
    static func temporizador(_ titulo: String, segundos: Int) {
        limpiar()
        guard ActivityAuthorizationInfo().areActivitiesEnabled, segundos > 0 else { return }
        let ahora = Date(), fin = ahora.addingTimeInterval(TimeInterval(segundos))
        let estado = AranaAttributes.ContentState(estado: String(titulo.prefix(30)), paso: 0, inicio: ahora, fin: fin)
        _ = try? Activity.request(attributes: AranaAttributes(orden: ""),
                                  content: ActivityContent(state: estado, staleDate: fin))
    }

    /// Quita de la Isla los temporizadores ya cumplidos (o todos, si se cancelan).
    static func limpiar(todos: Bool = false) {
        for a in Activity<AranaAttributes>.activities {
            guard let f = a.content.state.fin, todos || f <= Date().addingTimeInterval(2) else { continue }
            Task { await a.end(nil, dismissalPolicy: .immediate) }
        }
    }
}
