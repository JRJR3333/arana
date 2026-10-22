import AppIntents

/// «Oye Siri, pregunta a Araña»: Siri le pide la orden y la araña la ejecuta.
struct AskArana: AppIntent {
    static var title: LocalizedStringResource = "Preguntar a la araña"
    static var description = IntentDescription("Le da una orden a la araña.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Orden", requestValueDialog: "¿Qué desea?")
    var order: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = await Brain.ask(order)
        return .result(dialog: IntentDialog(stringLiteral: text))
    }
}

/// 0.31.0 (h7): «Oye Siri, recuerda en Araña»: Siri pregunta qué y la araña lo apunta sin abrir la app.
struct RecuerdaArana: AppIntent {
    static var title: LocalizedStringResource = "Recordar algo"
    static var description = IntentDescription("La araña apunta un dato suyo, sin abrir la app.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Dato", requestValueDialog: "¿Qué quiere que recuerde?")
    var dato: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let r = Recuerdo.apuntar(dato) ?? "No he entendido qué apuntar."
        return .result(dialog: IntentDialog(stringLiteral: r))
    }
}

struct AranaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskArana(),
                    phrases: ["Pregunta a \(.applicationName)", "Oye \(.applicationName)", "\(.applicationName)"],
                    shortTitle: "Hablar con la araña",
                    systemImageName: "ant")
        AppShortcut(intent: RecuerdaArana(),
                    phrases: ["Recuerda en \(.applicationName)", "Apunta en \(.applicationName)", "\(.applicationName), recuerda esto"],
                    shortTitle: "Recordar algo",
                    systemImageName: "brain")
    }
}
