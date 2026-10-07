import SwiftUI

@main
struct PhosphorStudyApp: App {
    @StateObject private var instrument = InstrumentModel()

    var body: some Scene {
        #if os(macOS)
        Window("Phosphor · Cycle Study", id: "instrument") {
            InstrumentView(model: instrument)
                .frame(minWidth: 420, minHeight: 650)
        }
        .defaultSize(width: 660, height: 780)
        #else
        WindowGroup {
            InstrumentView(model: instrument)
        }
        #endif
    }
}
