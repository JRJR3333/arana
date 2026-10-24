import SwiftUI
import UIKit

/// 0.43.0 (asistente): nuestra charla. La conversación entera, como un chat, guardada en este iPhone.
/// Va aparte de Memory.history (los 3 últimos turnos que se mandan a Claude): verla no gasta nada.
struct Mensaje: Codable, Identifiable, Equatable {
    var id = UUID()
    let deUsted: Bool
    let texto: String
    let fecha: Date
}

final class Charla: ObservableObject {
    static let shared = Charla()
    private static let clave = "arana.charla"
    static let maximo = 120
    @Published private(set) var mensajes: [Mensaje] = []

    init() {
        if let d = UserDefaults.standard.data(forKey: Self.clave),
           let m = try? JSONDecoder().decode([Mensaje].self, from: d) { mensajes = m }
    }

    func apuntar(_ texto: String, deUsted: Bool) {
        let t = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        if let u = mensajes.last, u.deUsted == deUsted, u.texto == t { return }
        mensajes.append(Mensaje(deUsted: deUsted, texto: String(t.prefix(600)), fecha: Date()))
        if mensajes.count > Self.maximo { mensajes.removeFirst(mensajes.count - Self.maximo) }
        guardar()
    }

    func borrar() { mensajes = []; guardar() }

    private func guardar() {
        if let d = try? JSONEncoder().encode(mensajes) { UserDefaults.standard.set(d, forKey: Self.clave) }
    }

    /// «nuestra charla», «ver la conversación»… abre la charla sin gastar API.
    static func esOrden(_ n: String) -> Bool {
        ["nuestra charla", "ver la charla", "abre la charla", "ver la conversacion", "abre la conversacion",
         "que hemos hablado", "de que hemos hablado", "historial", "ver el historial"].contains(n)
    }
}

/// La charla como un chat: usted a la derecha en azul, la araña a la izquierda. Se puede escribir desde aquí.
struct CharlaView: View {
    @ObservedObject var charla = Charla.shared
    var pensando: Bool
    var enviar: (String) -> Void
    @State private var texto = ""

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { sv in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        if charla.mensajes.isEmpty {
                            burbuja(Mensaje(deUsted: false, texto: "Aquí queda todo lo que hablemos. Dígame lo que quiera.", fecha: Date()))
                        }
                        ForEach(charla.mensajes) { m in burbuja(m).id(m.id) }
                        if pensando { Text("Pensando…").font(.caption).foregroundStyle(.secondary).id("pensando") }
                    }.padding()
                }
                .onAppear { if let u = charla.mensajes.last { sv.scrollTo(u.id, anchor: .bottom) } }
                .onChange(of: charla.mensajes) { _, m in
                    if let u = m.last { withAnimation { sv.scrollTo(u.id, anchor: .bottom) } }
                }
            }
            HStack {
                TextField("Escríbame", text: $texto).textFieldStyle(.roundedBorder).submitLabel(.send).onSubmit(mandar)
                Button("Ir", action: mandar).buttonStyle(.borderedProminent).disabled(pensando)
            }.padding()
        }
        .navigationTitle("Nuestra charla")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func mandar() {
        let t = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !pensando else { return }
        texto = ""; enviar(t)
    }

    private func burbuja(_ m: Mensaje) -> some View {
        HStack {
            if m.deUsted { Spacer(minLength: 40) }
            Text(m.texto)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(m.deUsted ? Color.blue : Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
                .foregroundStyle(m.deUsted ? Color.white : Color.primary)
                .accessibilityLabel((m.deUsted ? "Usted: " : "Araña: ") + m.texto)
            if !m.deUsted { Spacer(minLength: 40) }
        }
    }
}

/// 0.43.0: empezar de cero, solo si lo pide usted. Borra lo que sé, la charla y la telaraña; no toca la clave, el token ni el ajedrez.
enum EmpezarDeCero {
    static let claves = ["arana.historial", "arana.datos", "arana.charla", "arana.hilos"]
    static func hacer() {
        for k in claves { UserDefaults.standard.removeObject(forKey: k) }
        Charla.shared.borrar()
    }
}
