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

/// 0.43.0 (h7): «Oye Siri, qué sabe Araña de mí»: Siri lee lo que la araña tiene apuntado, sin abrir la app.
struct QueSabeArana: AppIntent {
    static var title: LocalizedStringResource = "Lo que sabe de mí"
    static var description = IntentDescription("La araña dice lo que tiene apuntado de usted, sin abrir la app.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: Recuerdo.loQueSe()))
    }
}

/// 0.44.0 (h7): «Oye Siri, calcula con Araña»: Siri pregunta la cuenta y la araña la resuelve en local, sin abrir la app ni gastar API.
struct CalculaArana: AppIntent {
    static var title: LocalizedStringResource = "Hacer una cuenta"
    static var description = IntentDescription("La araña hace la cuenta en el iPhone, sin abrir la app.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Cuenta", requestValueDialog: "¿Qué cuenta?")
    var cuenta: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let t = cuenta.lowercased().folding(options: .diacriticInsensitive, locale: Locale(identifier: "es_ES"))
            .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        let r = Rapido.cuenta(t) ?? Rapido.cuenta("cuanto es " + t) ?? "Esa cuenta no la sé. Dígamela con números, por ejemplo «12 por 7»."
        return .result(dialog: IntentDialog(stringLiteral: r))
    }
}

/// Sorpresa 0.45.0: «Oye Siri, cuéntame una curiosidad de Araña», sin abrir la app ni gastar API.
struct CuriosidadArana: AppIntent {
    static var title: LocalizedStringResource = "Una curiosidad"
    static var description = IntentDescription("La araña le cuenta una curiosidad de las arañas, sin abrir la app.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: Rapido.curiosidades.randomElement() ?? "Las arañas tejen sin prisa."))
    }
}

/// 0.47.0 (h7): «Oye Siri, pregunta a Wikipedia con Araña»: Siri pregunta qué y la araña lo contesta sin abrir la app ni gastar API.
struct SabeArana: AppIntent {
    static var title: LocalizedStringResource = "Qué es o quién es"
    static var description = IntentDescription("La araña le cuenta qué es algo o quién es alguien, con Wikipedia, sin abrir la app.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Tema", requestValueDialog: "¿Qué quiere saber?")
    var tema: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let limpio = tema.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        let t = limpio.lowercased().folding(options: .diacriticInsensitive, locale: Locale(identifier: "es_ES"))
        var r = await Wiki.responder(t, original: limpio)
        if r == nil, !limpio.isEmpty, let b = await Wiki.buscar(limpio) { r = b + " (Wikipedia)" }
        return .result(dialog: IntentDialog(stringLiteral: r ?? "No lo encuentro en Wikipedia. Pruebe con otras palabras."))
    }
}

/// 0.49.0 (h7, de noche): «Oye Siri, buenas noches, Araña»: le dice lo que tiene mañana sin abrir la app ni gastar API.
struct BuenasNochesArana: AppIntent {
    static var title: LocalizedStringResource = "Buenas noches"
    static var description = IntentDescription("La araña le dice lo que tiene mañana en el calendario y se despide, sin abrir la app.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: await Rapido.buenasNoches()))
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
        AppShortcut(intent: QueSabeArana(),
                    phrases: ["Qué sabe \(.applicationName) de mí", "Qué recuerda \(.applicationName) de mí", "\(.applicationName), qué sabes de mí"],
                    shortTitle: "Lo que sabe de mí",
                    systemImageName: "person.text.rectangle")
        AppShortcut(intent: CalculaArana(),
                    phrases: ["Calcula con \(.applicationName)", "Haz una cuenta con \(.applicationName)", "\(.applicationName), haz una cuenta"],
                    shortTitle: "Hacer una cuenta",
                    systemImageName: "plus.forwardslash.minus")
        AppShortcut(intent: CuriosidadArana(),
                    phrases: ["Cuéntame una curiosidad de \(.applicationName)", "Curiosidad de \(.applicationName)", "\(.applicationName), cuéntame algo curioso"],
                    shortTitle: "Una curiosidad",
                    systemImageName: "sparkles")
        AppShortcut(intent: SabeArana(),
                    phrases: ["Pregunta a Wikipedia con \(.applicationName)", "Qué es algo con \(.applicationName)", "\(.applicationName), qué es"],
                    shortTitle: "Qué es o quién es",
                    systemImageName: "book")
        AppShortcut(intent: BuenasNochesArana(),
                    phrases: ["Buenas noches, \(.applicationName)", "Buenas noches con \(.applicationName)", "Me voy a dormir con \(.applicationName)"],
                    shortTitle: "Buenas noches",
                    systemImageName: "moon.stars")
        // 0.50.0 (h8): «Oye Siri, luz suave con Araña»
        AppShortcut(intent: LuzSuaveIntent(),
                    phrases: ["Luz suave con \(.applicationName)", "\(.applicationName), luz suave", "Linterna flojita con \(.applicationName)"],
                    shortTitle: "Luz suave", systemImageName: "flashlight.on.fill")
    }
}
