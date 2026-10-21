import Foundation

/// 0.23.0: la araña se interesa por Juan. De vez en cuando le pregunta algo con opciones y lo recuerda (Memory.facts).
struct Pregunta {
    let texto: String
    let opciones: [String]
    let prefijo: String
}

enum Preguntas {
    static let todas: [Pregunta] = [
        Pregunta(texto: "¿Qué música le acompaña más?", opciones: ["Pop", "Rock", "Urbana", "Clásica", "De todo"], prefijo: "Su música: "),
        Pregunta(texto: "¿Café o té por la mañana?", opciones: ["Café", "Té", "Ninguno"], prefijo: "Por la mañana toma: "),
        Pregunta(texto: "¿Qué deporte sigue?", opciones: ["Fútbol", "Baloncesto", "Tenis", "Fórmula 1", "Ninguno"], prefijo: "Deporte que sigue: "),
        Pregunta(texto: "¿Es usted de madrugar o de trasnochar?", opciones: ["Madrugar", "Trasnochar"], prefijo: "Prefiere: "),
        Pregunta(texto: "¿Cómo suele moverse por Madrid?", opciones: ["Metro", "Coche", "Andando", "Bici", "Taxi"], prefijo: "Se mueve en: "),
        Pregunta(texto: "¿Playa o montaña?", opciones: ["Playa", "Montaña", "Ciudad"], prefijo: "Para viajar prefiere: "),
        Pregunta(texto: "¿Series o películas?", opciones: ["Series", "Películas", "Ninguna"], prefijo: "Ve más: "),
        Pregunta(texto: "¿Perros o gatos?", opciones: ["Perros", "Gatos", "Ninguno"], prefijo: "Animal favorito: "),
        Pregunta(texto: "¿Qué come más a gusto?", opciones: ["Pasta", "Arroz", "Carne", "Pescado", "Verdura"], prefijo: "Comida favorita: "),
        Pregunta(texto: "¿A qué hora suele acostarse?", opciones: ["Antes de las 23", "Entre 23 y 00", "Después de las 00"], prefijo: "Se acuesta: "),
        Pregunta(texto: "¿Le gustan los juegos de mesa?", opciones: ["Mucho", "A veces", "No"], prefijo: "Juegos de mesa: "),
        Pregunta(texto: "¿Qué parte del día le cunde más?", opciones: ["Mañana", "Tarde", "Noche"], prefijo: "Le cunde más por la: "),
        Pregunta(texto: "¿Qué le relaja más?", opciones: ["Música", "Deporte", "Una serie", "Salir", "Leer"], prefijo: "Le relaja: ")
    ]

    /// Una que aún no ha contestado, o nil si ya las ha contestado todas.
    static func siguiente() -> Pregunta? {
        let datos = Memory.facts
        return todas.filter { p in !datos.contains { $0.hasPrefix(p.prefijo) } }.randomElement()
    }

    static func guardar(_ p: Pregunta, _ respuesta: String) {
        Memory.remember(p.prefijo + respuesta.lowercased() + ".")
    }
}

/// 0.23.0: lo que la araña hace con su cuerpo. Mismos nombres que el paso «spider» de la web.
enum Movimiento: String, CaseIterable {
    case dance, walk, spin, jump, come, hide, bow

    var frase: String {
        switch self {
        case .dance: return ["Un pasito de baile, con permiso.", "Ocho patas, ocho compases.", "Bailo poco, pero bailo bien."].randomElement()!
        case .walk: return ["Doy un paseo.", "Estiro las patas."].randomElement()!
        case .spin: return "Una vuelta tejiendo."
        case .jump: return ["¡Hop!", "Salto de mayordomo."].randomElement()!
        case .come: return ["Aquí estoy.", "A su servicio."].randomElement()!
        case .hide: return "Me escondo en el borde. Tóqueme para volver."
        case .bow: return "Para servirle."
        }
    }

    /// Entiende la orden en local, sin gastar API. `t` llega en minúsculas y sin tildes.
    static func desde(_ t: String) -> Movimiento? {
        let w = t.split(separator: " ").count
        guard w <= 5 else { return nil }
        func has(_ l: [String]) -> Bool { l.contains { t == $0 || t.hasPrefix($0 + " ") } }
        if (t.contains("baila") || t.contains("bailar") || t.contains("un baile")) && !t.contains("musica") && !t.contains("cancion") { return .dance }
        if has(["camina", "anda", "pasea", "muevete", "da un paseo", "date un paseo", "estira las patas"]) { return .walk }
        if has(["da una vuelta", "date una vuelta", "haz una vuelta", "gira", "teje", "haz una telarana"]) { return .spin }
        if has(["salta", "da un salto", "pega un salto", "brinca"]) { return .jump }
        if ["ven", "ven aqui", "vuelve", "vuelve aqui", "a tu sitio", "vuelve a tu sitio", "aparece", "ven arana"].contains(t) { return .come }
        if has(["escondete", "ocultate", "desaparece", "vete al borde"]) { return .hide }
        if has(["haz una reverencia", "reverencia", "inclinate", "saluda"]) { return .bow }
        return nil
    }
}
