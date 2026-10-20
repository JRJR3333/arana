import Foundation

/// Un paso del plan que devuelve Claude.
struct Step: Codable {
    var type: String          // "open" | "reminder" | "call" | "message" | "timer"
    var url: String?          // para "open": enlace de la app (spotify://, whatsapp://…)
    var text: String?         // para "reminder" y "message"
    var minutes: Int?         // para "reminder" y "timer": dentro de cuántos minutos avisar
    var seconds: Int?         // para "timer": segundos sueltos
    var phone: String?        // para "call" y "message"
}

struct Plan: Codable {
    var say: String
    var steps: [Step]?
    var remember: String?     // algo de Juan que conviene recordar
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

    static let system = """
    Eres «Araña», el mayordomo de Juan dentro de su iPhone: serio, trata de usted, frases cortas. \
    Responde siempre con la herramienta plan. "say" es lo que dirás en voz alta (una o dos frases). \
    Pasos posibles: open (url con el enlace de la app, p. ej. spotify://, whatsapp://, instagram://, youtube://, maps://?q=lugar), \
    reminder (text y minutes), timer (minutes y/o seconds, text opcional: temporizador o alarma dentro de un rato), \
    call (phone), message (phone y text). Si no hace falta ningún paso, steps vacío. \
    Siga el hilo de la conversación. Si Juan le cuenta algo duradero de sí mismo (gustos, personas, costumbres), \
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
                        "type": ["type": "string", "enum": ["open", "reminder", "call", "message", "timer"]],
                        "url": ["type": "string"], "text": ["type": "string"],
                        "minutes": ["type": "integer"], "seconds": ["type": "integer"], "phone": ["type": "string"]
                    ],
                    "required": ["type"]
                ]],
                "remember": ["type": "string"]
            ],
            "required": ["say", "steps"]
        ]
    ]

    /// Orden completa: pensar, hacer, recordar. La usan la pantalla y Siri.
    @MainActor
    static func ask(_ text: String) async -> String {
        do {
            let plan = try await think(text)
            let fails = await Actions.run(plan.steps ?? [])
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

    /// El sistema más lo poco que sabe de Juan.
    static func systemNow() -> String {
        let f = Memory.facts
        return f.isEmpty ? system : system + "\nLo que sabe de Juan: " + f.joined(separator: "; ")
    }
}
