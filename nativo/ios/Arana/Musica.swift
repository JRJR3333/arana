import MediaPlayer

/// La música del iPhone desde la araña: reproducir, pausar, saltar y buscar en su biblioteca (Apple Music).
@MainActor
enum Musica {
    /// Devuelve el problema si no sale; nil si está hecho.
    static func run(action: String?, query: String?) async -> String? {
        let p = MPMusicPlayerController.systemMusicPlayer
        switch action ?? "play" {
        case "pause": p.pause(); return nil
        case "next": p.skipToNextItem(); return nil
        case "previous": p.skipToPreviousItem(); return nil
        default:
            let q = (query ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !q.isEmpty else { p.play(); return nil }
            let st = await withCheckedContinuation { (c: CheckedContinuation<MPMediaLibraryAuthorizationStatus, Never>) in
                MPMediaLibrary.requestAuthorization { c.resume(returning: $0) }
            }
            guard st == .authorized else { return "No tengo permiso para su música. Actívelo en Ajustes → Araña." }
            for prop in [MPMediaItemPropertyTitle, MPMediaItemPropertyArtist, MPMediaItemPropertyAlbumTitle] {
                let busca = MPMediaQuery.songs()
                busca.addFilterPredicate(MPMediaPropertyPredicate(value: q, forProperty: prop, comparisonType: .contains))
                if let items = busca.items, !items.isEmpty {
                    p.setQueue(with: MPMediaItemCollection(items: items))
                    p.play()
                    return nil
                }
            }
            return "No encuentro «\(q)» en su música."
        }
    }

    /// Órdenes sencillas que no gastan API. Devuelve la respuesta o nil si no es de música.
    static func quick(_ t: String) async -> String? {
        let pausa = ["pausa la musica", "para la musica", "quita la musica", "pausa", "para la cancion"]
        if pausa.contains(t) { _ = await run(action: "pause", query: nil); return "Música en pausa." }
        if ["siguiente cancion", "siguiente", "pasa de cancion", "otra cancion"].contains(t) { _ = await run(action: "next", query: nil); return "Siguiente." }
        if ["cancion anterior", "anterior", "la de antes"].contains(t) { _ = await run(action: "previous", query: nil); return "La anterior." }
        if ["pon musica", "pon algo de musica", "musica", "sigue la musica", "reanuda la musica"].contains(t) { _ = await run(action: "play", query: nil); return "Música." }
        return nil
    }
}
