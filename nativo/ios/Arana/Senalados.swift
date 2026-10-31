import Foundation

/// Sorpresa 0.50.0: los días señalados la araña lo dice al abrir, una sola vez ese día.
/// Se quita borrando este archivo y su línea en ContentView.swift.
enum Senalados {
    static let clave = "arana.senalado"

    static func frase(_ fecha: Date = Date()) -> String? {
        let c = Calendar.current.dateComponents([.month, .day], from: fecha)
        switch (c.month ?? 0, c.day ?? 0) {
        case (10, 31): return "Feliz Halloween. Esta noche es la mía: hoy nadie se asusta de una araña."
        case (11, 1): return "Hoy es Todos los Santos. Un buen día para acordarse de los suyos."
        case (12, 24): return "Nochebuena. Hoy tejo con hilo dorado."
        case (12, 25): return "Feliz Navidad. Le he dejado la tela limpia."
        case (12, 31): return "Último día del año. ¿Le apunto algún propósito? Dígame «recuerda…»."
        case (1, 1): return "Feliz año nuevo. Empiezo el año a su servicio."
        case (1, 6): return "Día de Reyes. Yo solo pido moscas."
        case (2, 14): return "San Valentín. Las arañas tejemos corazones con paciencia."
        case (4, 23): return "Día del libro. ¿Me pregunta qué es alguno? Me lo sé por Wikipedia."
        default: return nil
        }
    }

    /// La frase de hoy si aún no la ha dicho.
    static func saludoDeHoy(_ fecha: Date = Date()) -> String? {
        guard let f = frase(fecha) else { return nil }
        let hoy = fecha.formatted(.iso8601.year().month().day())
        let d = UserDefaults.standard
        guard d.string(forKey: clave) != hoy else { return nil }
        d.set(hoy, forKey: clave)
        return f
    }
}
