import ActivityKit
import Foundation

/// Lo que la Isla Dinámica muestra mientras la araña trabaja (lo comparten la app y su extensión).
struct AranaAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var estado: String      // "Pensando…", "Hecho", …
        var paso: Int           // para mover las patas: cambia en cada actualización
    }
    var orden: String
}

