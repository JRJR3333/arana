import Foundation

/// Un paso del plan que devuelve Claude.
struct Step: Codable {
    var type: String          // "open" | "reminder" | "call" | "message" | "timer"
    var url: String?          // para "open": enlace de la app (spotify://, whatsapp://…)
    var text: String?         // para "reminder" y "message"
    var minutes: Int?         // para "reminder" y "timer": dentro de cuántos minutos avisar
    var seconds: Int?         // para "timer": segundos sueltos
    var phone: String?        // para "call" y "message"
    var when: String?         // para "event": fecha local AAAA-MM-DDTHH:MM
    var duration: Int?        // para "event": minutos que dura (60 si no se dice)
    var days: Int?            // para "agenda": 0 hoy, 1 mañana
    var action: String?       // para "music": play | pause | next | previous
    var to: String? = nil     // 0.46.0: para "call", "message" y "whatsapp": nombre del contacto
}

struct Plan: Codable {
    var say: String
    var steps: [Step]?
    var remember: String?     // algo de Juan que conviene recordar
    var cannot: String?       // 0.23.0: lo que no puede hacer, en una frase
    var skill_request: String? // 0.23.0: la habilidad que Claude podría programar para lograrlo
}

enum BrainError: LocalizedError {
    case noKey, http(Int, String), noPlan
    var errorDescription: String? {
        switch self {
        case .noKey: return "Aún no tengo clave. Póngala en Ajustes."
        case .http(let c, let m): return "Anthropic dice \(c): \(m)"
        case .noPlan: return "No me ha llegado un plan."
        }
    }
}

/// El cerebro: manda la orden a Claude y recibe un plan. Gastar poco: respuestas cortas y sin historial largo.
enum Brain {
    static let model = "claude-haiku-5-5"
    /// 0.23.0: lo que la pantalla tiene que hacer después de contestar: movimientos de la araña y lo que no supo hacer.
    @MainActor static var movimientos: [String] = []
    @MainActor static var deseo: (frase: String, motivo: String)?

    static let system = """
    Eres «Araña», el mayordomo de Juan dentro de su iPhone: serio, trata de usted, frases cortas. \
    Responde siempre con la herramienta plan. "say" es lo que dirás en voz alta (una o dos frases). \
    Pasos posibles: open (url con el enlace de la app, p. ej. spotify://, whatsapp://, instagram://, youtube://, maps://?q=lugar), \
    reminder (text, y minutes o when AAAA-MM-DDTHH:MM: recordatorio con aviso a esa hora), timer (minutes y/o seconds, text opcional: temporizador o alarma dentro de un rato), \
    call (phone, o to con el nombre del contacto), message (SMS: text y phone o to), whatsapp (text y to: abre su chat con el texto; Juan pulsa enviar), event (text, when AAAA-MM-DDTHH:MM o minutes, duration: cita en el calendario), \
    agenda (days 0 hoy, 1 mañana: leer el calendario), \
    music (action play|pause|next|previous; text opcional: canción, artista o disco de su biblioteca), \
    search (text: buscar en internet con Safari), \
    spider (action dance|walk|spin|jump|come|hide|bow: lo que hace usted con su cuerpo en la pantalla: bailar, pasear, dar una vuelta, saltar, volver a su sitio, esconderse, reverencia). Si no hace falta ningún paso, steps vacío. \
    Si le piden HACER algo que estos pasos no permiten, no finja que lo hace: explíquelo en cannot y, si una habilidad nueva programable lo resolvería, descríbala en skill_request (Claude la programará). \
    Esto es una conversación: los mensajes anteriores son lo último que se han dicho; si la frase sigue el hilo («¿y mañana?», «sí», «el segundo»), entiéndala así. Siga el hilo de la conversación. Si Juan le cuenta algo duradero de sí mismo (gustos, personas, costumbres), \
    póngalo en remember como frase corta en tercera persona.
    """

    static let tool: [String: Any] = [
        "name": "plan",
        "description": "Lo que dice la araña y los pasos a ejecutar en el iPhone.",
        "input_schema": [
            "type": "object",
            "properties": [
                "say": ["type": "string"],
                "steps": ["type": "array", "items": [
                    "type": "object",
                    "properties": [
                        "type": ["type": "string", "enum": ["open", "reminder", "call", "message", "whatsapp", "timer", "event", "agenda", "music", "search", "spider"]],
                        "url": ["type": "string"], "text": ["type": "string"],
                        "minutes": ["type": "integer"], "seconds": ["type": "integer"], "phone": ["type": "string"], "to": ["type": "string"],
                        "when": ["type": "string"], "duration": ["type": "integer"], "days": ["type": "integer"], "action": ["type": "string"]
                    ],
                    "required": ["type"]
                ]],
                "remember": ["type": "string"],
                "cannot": ["type": "string"],
                "skill_request": ["type": "string"]
            ],
            "required": ["say", "steps"]
        ]
    ]

    /// Orden completa: pensar, hacer, recordar. La usan la pantalla y Siri.
    @MainActor
    static func ask(_ text: String) async -> String {
        if let local = await quick(text) { return local }
        Isla.start(text)
        defer { Isla.end() }
        do {
            let plan = try await think(text)
            let pasos = plan.steps ?? []
            movimientos = pasos.filter { $0.type == "spider" }.compactMap { $0.action }
            if let no = plan.cannot, !no.isEmpty { deseo = (text, plan.skill_request ?? no) }
            let fails = await Actions.run(pasos.filter { $0.type != "spider" })
            let reply = ([plan.say] + fails).joined(separator: " ")
            if let f = plan.remember { Memory.remember(f) }
            Memory.addTurn(user: text, reply: reply)
            if fails.isEmpty { Memory.addThread() }
            return reply
        } catch {
            return error.localizedDescription
        }
    }

    static func think(_ text: String) async throws -> Plan {
        let key = Keychain.load()
        guard !key.isEmpty else { throw BrainError.noKey }
        var req = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue(key, forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        let body: [String: Any] = [
            "model": model, "max_tokens": 350, "system": systemNow(),
            "tools": [tool], "tool_choice": ["type": "tool", "name": "plan"],
            "messages": Memory.history + [["role": "user", "content": text]]
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200 else {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let msg = ((obj?["error"] as? [String: Any])?["message"] as? String) ?? String(decoding: data, as: UTF8.self)
            throw BrainError.http(code, String(msg.prefix(200)))
        }
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let content = obj["content"] as? [[String: Any]],
              let use = content.first(where: { ($0["type"] as? String) == "tool_use" }),
              let input = use["input"] else { throw BrainError.noPlan }
        let planData = try JSONSerialization.data(withJSONObject: input)
        return try JSONDecoder().decode(Plan.self, from: planData)
    }

    /// Lo que se resuelve en local, sin gastar API: hora, fecha, cuentas, azar, música, metrónomo y la agenda.
    @MainActor
    static func quick(_ text: String) async -> String? {
        let t = text.lowercased().folding(options: .diacriticInsensitive, locale: Locale(identifier: "es_ES"))
            .trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
        // 0.46.0: «cambiemos de tema» corta el hilo de la conversación (lo que sabe de Juan no se toca)
        if ["cambiemos de tema", "cambia de tema", "otro tema", "hablemos de otra cosa", "olvida esta conversacion", "olvida la conversacion"].contains(t) {
            Memory.olvidarHilo()
            return "De acuerdo. Hablemos de otra cosa."
        }
        if let r = Recuerdo.responder(t, original: text.trimmingCharacters(in: .whitespacesAndNewlines)) {
            Memory.addTurn(user: text, reply: r)
            return r
        }
        // 0.49.0 (asistente, de noche): la linterna, en local
        if let r = Linterna.quick(t) {
            Memory.addTurn(user: text, reply: r)
            return r
        }
        // 0.49.0 (h7, de noche): «buenas noches» repasa lo de mañana, en local
        if ["buenas noches", "me voy a dormir", "me voy a la cama", "hasta manana", "a dormir"].contains(t) {
            let r = await Rapido.buenasNoches()
            Memory.addTurn(user: text, reply: r)
            return r
        }
        if let q = Rapido.busqueda(t) {
            _ = await Actions.run([Step(type: "search", text: q)])
            let r = q.isEmpty ? "Le abro el buscador." : "Busco «\(q)» en internet."
            Memory.addTurn(user: text, reply: r)
            return r
        }
        // 0.48.0 (h7): recordatorios a una hora y temporizadores, en local y sin gastar API
        if let av = Recordar.paso(t, original: text.trimmingCharacters(in: .whitespacesAndNewlines)) {
            let paso = av.0, dicho = av.1
            let fails = await Actions.run([paso])
            let r = fails.isEmpty ? dicho : fails.joined(separator: " ")
            Memory.addTurn(user: text, reply: r)
            return r
        }
        // 0.45.0 (h7): «otra voz» cambia la voz de la araña y la recuerda
        if ["otra voz", "cambia de voz", "cambia la voz", "cambiate la voz", "pon otra voz", "habla con otra voz", "cambia tu voz"].contains(t) {
            let r = Voice.shared.siguiente()
            Memory.addTurn(user: text, reply: r)
            return r
        }
        if let r = Rapido.responder(t) {
            Memory.addTurn(user: text, reply: r)
            return r
        }
        // 0.47.0 (asistente): «qué es…», «quién fue…» lo contesta Wikipedia, gratis y sin gastar API
        if let r = await Wiki.responder(t, original: text) {
            Memory.addTurn(user: text, reply: r)
            return r
        }
        let musica = await Musica.quick(t)
        if let r = musica ?? Metronomo.shared.quick(t) {
            Memory.addTurn(user: text, reply: r)
            return r
        }
        let pide = ["que tengo", "mi agenda", "la agenda", "mi calendario", "tengo algo"].contains { t.contains($0) }
        guard pide, t.count < 40 else { return nil }
        let reply = await Actions.agenda(days: t.contains("manana") ? 1 : 0)
        Memory.addTurn(user: text, reply: reply)
        return reply
    }

    /// El sistema más la fecha y lo poco que sabe de Juan.
    static func systemNow() -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_ES")
        f.dateFormat = "EEEE yyyy-MM-dd'T'HH:mm"
        var s = system + "\nAhora: " + f.string(from: Date()) + "."
        let datos = Memory.facts
        if !datos.isEmpty { s += "\nLo que sabe de Juan: " + datos.joined(separator: "; ") }
        return s
    }
}
