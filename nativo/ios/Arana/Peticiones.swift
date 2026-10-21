import Foundation

/// 0.23.0: lo que la araña no sabe hacer se lo pide a Claude con una petición en GitHub (etiqueta `nueva-habilidad`).
/// Con un token de GitHub (Ajustes) la crea ella sola; sin token, abre GitHub y Juan pulsa «Create».
enum Peticiones {
    static let cuenta = "github-token"
    static let repo = "JRJR3333/arana"
    private static let kEnviadas = "arana.peticiones"

    static var token: String { Keychain.load(account: cuenta) }

    static func yaPedida(_ frase: String) -> Bool {
        (UserDefaults.standard.stringArray(forKey: kEnviadas) ?? []).contains(frase.lowercased())
    }

    private static func apuntar(_ frase: String) {
        var l = UserDefaults.standard.stringArray(forKey: kEnviadas) ?? []
        l.append(frase.lowercased())
        UserDefaults.standard.set(Array(l.suffix(80)), forKey: kEnviadas)
    }

    static func titulo(_ frase: String) -> String { "Araña quiere aprender: " + frase }

    static func cuerpo(_ frase: String, _ motivo: String) -> String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        return """
        **Lo que pidió Juan:** «\(frase)»
        **Lo que respondió la araña:** \(motivo)
        **Veces pedido:** 1

        **Contexto**
        - Versión: \(v) (app de iPhone)
        - Dispositivo: iPhone, app nativa

        _Petición creada desde la app de iPhone. Si iOS no lo permite, explicarlo y cerrar con la etiqueta `no-posible`._
        """
    }

    /// Enlace para crearla a mano en GitHub.
    static func url(_ frase: String, _ motivo: String) -> URL? {
        var c = URLComponents(string: "https://github.com/\(repo)/issues/new")
        c?.queryItems = [URLQueryItem(name: "labels", value: "nueva-habilidad"),
                         URLQueryItem(name: "title", value: titulo(frase)),
                         URLQueryItem(name: "body", value: cuerpo(frase, motivo))]
        return c?.url
    }

    /// La crea con el token. Devuelve la frase que dice la araña.
    static func pedir(_ frase: String, _ motivo: String) async -> String {
        let tok = token
        guard !tok.isEmpty else { return "Necesito un token de GitHub en Ajustes para pedírselo yo sola." }
        if yaPedida(frase) { return "Esto ya se lo pedí a Claude. Está en ello." }
        var req = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/issues")!)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("Bearer " + tok, forHTTPHeaderField: "Authorization")
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["title": titulo(frase), "body": cuerpo(frase, motivo), "labels": ["nueva-habilidad"]]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard code == 201 else {
                return code == 401 || code == 403 ? "Mi token de GitHub no vale. Revíselo en Ajustes." : "GitHub no me deja ahora (\(code)). Lo intento otro día."
            }
            apuntar(frase)
            let n = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["number"] as? Int
            return "Se lo he pedido a Claude" + (n.map { " (petición \($0))" } ?? "") + ". Cuando lo aprenda, se lo diré."
        } catch {
            return "No he podido pedírselo a Claude ahora."
        }
    }
}
