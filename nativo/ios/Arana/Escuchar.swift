import AppIntents
import Foundation

/// 0.21.0 (h8): «Escuchar a la araña». Abre la app con el micrófono ya puesto.
/// Lo usan el control del Centro de control, la pantalla bloqueada y el botón de Acción.
struct EscucharIntent: AppIntent {
    static var title: LocalizedStringResource = "Hablar con la araña"
    static var description = IntentDescription("Abre la araña escuchando.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(true, forKey: Escuchar.clave)
        NotificationCenter.default.post(name: Escuchar.aviso, object: nil)
        return .result()
    }
}

enum Escuchar {
    static let clave = "arana.escucharYa"
    static let aviso = Notification.Name("arana.escuchar")

    /// true una sola vez si alguien pidió escuchar al abrir.
    static func pendiente() -> Bool {
        let d = UserDefaults.standard
        guard d.bool(forKey: clave) else { return false }
        d.set(false, forKey: clave)
        return true
    }
}

/// 0.50.0 (h8): «Luz suave» en el Centro de control, la pantalla bloqueada y el botón de Acción.
/// Abre la araña y enciende la linterna muy flojita; si ya estaba encendida, la apaga.
/// La linterna se usa desde la app (un widget no puede tocarla).
struct LuzSuaveIntent: AppIntent {
    static var title: LocalizedStringResource = "Luz suave"
    static var description = IntentDescription("Abre la araña y enciende la linterna flojita, o la apaga.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(true, forKey: Escuchar.claveLuz)
        NotificationCenter.default.post(name: Escuchar.avisoLuz, object: nil)
        return .result()
    }
}

extension Escuchar {
    static let claveLuz = "arana.luzYa"
    static let avisoLuz = Notification.Name("arana.luz")

    /// true una sola vez si alguien pidió la luz suave al abrir.
    static func luzPendiente() -> Bool {
        let d = UserDefaults.standard
        guard d.bool(forKey: claveLuz) else { return false }
        d.set(false, forKey: claveLuz)
        return true
    }
}

/// 0.55.0 (h8): «Temporizador 5 min» en el Centro de control, la pantalla bloqueada y el botón de Acción.
/// Abre la araña y pone el temporizador como si usted se lo dijera (en local, con su cuenta atrás en la Isla).
struct TemporizadorRapidoIntent: AppIntent {
    static var title: LocalizedStringResource = "Temporizador de 5 minutos"
    static var description = IntentDescription("Abre la araña y pone un temporizador de 5 minutos.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set("pon un temporizador de 5 minutos", forKey: Escuchar.claveOrden)
        NotificationCenter.default.post(name: Escuchar.avisoOrden, object: nil)
        return .result()
    }
}

extension Escuchar {
    static let claveOrden = "arana.ordenYa"
    static let avisoOrden = Notification.Name("arana.orden")

    /// La orden que dejó un control al abrir la app, una sola vez.
    static func ordenPendiente() -> String? {
        let d = UserDefaults.standard
        guard let o = d.string(forKey: claveOrden), !o.isEmpty else { return nil }
        d.removeObject(forKey: claveOrden)
        return o
    }
}

/// 0.58.0 (h8): «Alarma de siempre» en el Centro de control, la pantalla bloqueada y el botón de Acción.
/// Abre la araña y le pone la alarma a la hora de la última vez (o le pregunta la hora si aún no la sabe).
struct AlarmaSiempreIntent: AppIntent {
    static var title: LocalizedStringResource = "Alarma de siempre"
    static var description = IntentDescription("Abre la araña y pone la alarma a la hora de siempre.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set("pon la alarma de siempre", forKey: Escuchar.claveOrden)
        NotificationCenter.default.post(name: Escuchar.avisoOrden, object: nil)
        return .result()
    }
}
