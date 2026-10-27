import Contacts
import Foundation

/// 0.46.0 (h7): busca a alguien en los contactos del iPhone por su nombre, para llamarle o escribirle
/// («manda un mensaje a Pedro diciendo que llego tarde», «llama a mamá», «escribe a Ana por WhatsApp»).
enum Contactos {
    struct Contacto: Sendable { let nombre: String; let tel: String }

    private static func limpio(_ s: String) -> String {
        let t = s.lowercased().folding(options: .diacriticInsensitive, locale: Locale(identifier: "es_ES"))
        let solo = t.map { $0.isLetter || $0.isNumber ? $0 : " " }
        return String(solo).split(separator: " ").joined(separator: " ")
    }

    /// El contacto que mejor encaja: el nombre exacto, luego el que empieza así, luego el que lo contiene. nil si no hay permiso.
    static func buscar(_ quien: String) async -> Contacto? {
        var q = limpio(quien)
        if q.hasPrefix("mi ") { q = String(q.dropFirst(3)) }
        let q0 = q
        guard !q0.isEmpty else { return nil }
        let store = CNContactStore()
        let estado = CNContactStore.authorizationStatus(for: .contacts)
        if estado == .denied || estado == .restricted { return nil }
        if estado == .notDetermined {
            let ok = (try? await store.requestAccess(for: .contacts)) ?? false
            if !ok { return nil }
        }
        return await Task.detached { () -> Contacto? in
            let q = q0
            let keys = [CNContactGivenNameKey, CNContactFamilyNameKey, CNContactNicknameKey, CNContactPhoneNumbersKey] as [CNKeyDescriptor]
            let req = CNContactFetchRequest(keysToFetch: keys)
            var mejor: Contacto?
            var nota = 0
            try? store.enumerateContacts(with: req) { c, _ in
                guard let tel = c.phoneNumbers.first?.value.stringValue else { return }
                let nombre = [c.givenName, c.familyName].filter { !$0.isEmpty }.joined(separator: " ")
                for n in [limpio(nombre), limpio(c.nickname)] where !n.isEmpty {
                    let p = n == q ? 4 : n.hasPrefix(q + " ") ? 3 : n.split(separator: " ").contains(Substring(q)) ? 2 : n.contains(q) ? 1 : 0
                    if p > nota { nota = p; mejor = Contacto(nombre: nombre.isEmpty ? c.nickname : nombre, tel: tel) }
                }
            }
            return mejor
        }.value
    }

    /// El número como lo quiere WhatsApp: con prefijo de país y solo cifras (9 cifras = España).
    static func internacional(_ tel: String) -> String {
        let t = tel.trimmingCharacters(in: .whitespaces)
        var d = t.filter { $0.isNumber }
        if t.hasPrefix("00") { d = String(d.dropFirst(2)) } else if !t.hasPrefix("+") && d.count == 9 { d = "34" + d }
        return d
    }
}
