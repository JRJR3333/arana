import ActivityKit
import Foundation

/// Lo que la Isla Dinámica muestra mientras la araña trabaja (lo comparten la app y su extensión).
struct AranaAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var estado: String      // "Pensando…", "Hecho", …
        var paso: Int           // para mover las patas: cambia en cada actualización
        // 0.52.0 (h8): si es un temporizador, cuándo empezó y cuándo acaba (la Isla lleva la cuenta atrás)
        var inicio: Date? = nil
        var fin: Date? = nil
        // 0.60.0 (h8): si es el sonido para dormir (su botón lo apaga en vez de parar un temporizador)
        var ruido: Bool? = nil
    }
    var orden: String
}

