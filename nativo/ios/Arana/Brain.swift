import Foundation

/// Un paso del plan que devuelve Claude.
struct Step: Codable {
    var type: String          // "open" | "reminder" | "call" | "message"
    var url: String?          // para "open": enlace de la app (spotify://, whatsapp://…)
    var text: String?         // para "reminder" y "message"
    var minutes: Int?         // para "reminder": dentro de cuántos minutos avisar
    var phone: String?        // para "call" y "message"
}

struct Plan: Codable {
    var say: String
    var steps: [Step]?
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
    reminder (text y minutes), call (phone), message (phone y text). Si no hace falta ningún paso, steps vacío.
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
                        "type": ["type": "string", "enum": ["open", "reminder", "call", "message"]],
                        "url": ["type": "string"], "text": ["type": "string"],
                        "minutes": ["type": "integer"], "phone": ["type": "string"]
                    ],
                    "required": ["type"]
                ]]
            ],
            "required": ["say", "steps"]
        ]
    ]

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
            "model": model, "max_tokens": 350, "system": system,
            "tools": [tool], "tool_choice": ["type": "tool", "name": "plan"],
            "messages": [["role": "user", "content": text]]
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
}
