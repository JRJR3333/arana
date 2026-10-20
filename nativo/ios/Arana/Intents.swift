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
        do {
            let plan = try await Brain.think(order)
            let fails = await Actions.run(plan.steps ?? [])
            let text = ([plan.say] + fails).joined(separator: " ")
            return .result(dialog: IntentDialog(stringLiteral: text))
        } catch {
            return .result(dialog: IntentDialog(stringLiteral: error.localizedDescription))
        }
    }
}

struct AranaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskArana(),
                    phrases: ["Pregunta a \(.applicationName)", "Oye \(.applicationName)", "\(.applicationName)"],
                    shortTitle: "Hablar con la araña",
                    systemImageName: "ant")
    }
}
