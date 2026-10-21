import SwiftUI
import WebKit

/// La sala de ajedrez dentro de la app: la misma de la web (ajedrez/ en GitHub Pages), en un WKWebView.
/// La sala habla con la app por window.webkit.messageHandlers.arana: «salir», «hito» (crece la telaraña) y «guardar» (copia de las arañas).
struct SalaAjedrez: View {
    var entrenar: Bool
    var cerrar: () -> Void
    var hito: (String) -> Void
    @State private var archivo: ArchivoCompartido?

    var body: some View {
        SalaWeb(entrenar: entrenar, cerrar: cerrar, hito: hito, compartir: { archivo = ArchivoCompartido(url: $0) })
            .ignoresSafeArea()
            .background(Color(red: 0.035, green: 0.04, blue: 0.08).ignoresSafeArea())
            // Entrenar necesita la pantalla encendida
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
            .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
            .sheet(item: $archivo) { a in Compartir(items: [a.url]) }
    }

    /// «vamos a jugar al ajedrez», «ajedrez», «entrena»…: true = entrenar, false = abrir la sala, nil = no es una orden de ajedrez.
    static func orden(_ n: String) -> Bool? {
        let entrena = ["entrena", "entrenar", "entrenate", "ponte a entrenar", "vamos a entrenar", "a entrenar", "entrena al ajedrez", "entrena el ajedrez", "entrena tus aranas"]
        if entrena.contains(n) { return true }
        guard n.contains("ajedrez") || n.contains("sala de partidas") else { return nil }
        if n.hasPrefix("que es") || n.contains("historia") || n.contains("reglas de") { return nil }
        return n.contains("entren")
    }
}

struct ArchivoCompartido: Identifiable { let id = UUID(); let url: URL }

struct SalaWeb: UIViewRepresentable {
    let entrenar: Bool
    let cerrar: () -> Void
    let hito: (String) -> Void
    let compartir: (URL) -> Void
    static let direccion = "https://jrjr3333.github.io/arana/ajedrez/?plat=iphone&app=ios"

    func makeCoordinator() -> Coordinador { Coordinador(self) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()   // las arañas se guardan en este iPhone y siguen ahí al volver
        cfg.userContentController.add(context.coordinator, name: "arana")
        let w = WKWebView(frame: .zero, configuration: cfg)
        w.isOpaque = false
        w.backgroundColor = UIColor(red: 0.035, green: 0.04, blue: 0.08, alpha: 1)
        w.scrollView.backgroundColor = w.backgroundColor
        w.scrollView.contentInsetAdjustmentBehavior = .never
        w.allowsBackForwardNavigationGestures = false
        if let u = URL(string: Self.direccion + (entrenar ? "&entrenar=1" : "")) { w.load(URLRequest(url: u)) }
        return w
    }

    func updateUIView(_ w: WKWebView, context: Context) { context.coordinator.padre = self }

    static func dismantleUIView(_ w: WKWebView, coordinator: Coordinador) {
        w.configuration.userContentController.removeScriptMessageHandler(forName: "arana")
    }

    final class Coordinador: NSObject, WKScriptMessageHandler {
        var padre: SalaWeb
        init(_ p: SalaWeb) { padre = p }
        func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage) {
            guard let d = m.body as? [String: Any], let tipo = d["tipo"] as? String else { return }
            switch tipo {
            case "salir": padre.cerrar()
            case "hito": padre.hito(d["texto"] as? String ?? "")
            case "guardar":
                let nombre = (d["nombre"] as? String).map { $0.replacingOccurrences(of: "/", with: "-") } ?? "arana-ajedrez.json"
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(nombre)
                guard let datos = (d["texto"] as? String)?.data(using: .utf8), (try? datos.write(to: url)) != nil else { return }
                padre.compartir(url)
            default: break
            }
        }
    }
}

/// La hoja de compartir de iOS: para guardar la copia en Archivos, en Drive o mandarla al Android.
struct Compartir: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ c: UIActivityViewController, context: Context) {}
}
