import SwiftUI
import Foundation

@MainActor
final class InstrumentModel: ObservableObject {
    static let sampleCount = 256
    @Published var wave: [Float]
    @Published var volume: Double = 0.3 {
        didSet { audio?.setVolume(Float(volume)) }
    }
    @Published private(set) var activeNote: Int?
    @Published private(set) var status = "Draw a cycle. Hold a key to hear it."
    @Published private(set) var error: String?
    @Published private(set) var canUndo = false
    private var audio: AudioController?
    private var previousWave: [Float]?
    private var tapTask: Task<Void, Never>?
    private let persistenceKey = "phosphor.cycle-study.wave.v1"

    init() {
        if let data = UserDefaults.standard.data(forKey: persistenceKey),
           let saved = try? JSONDecoder().decode([Float].self, from: data),
           saved.count == Self.sampleCount, saved.allSatisfy({ $0.isFinite && abs($0) <= 1 }) {
            wave = saved
        } else {
            wave = Self.preset("Sine")
        }
    }

    static func preset(_ name: String) -> [Float] {
        (0..<sampleCount).map { index in
            let t = Double(index) / Double(sampleCount)
            switch name {
            case "Triangle": return Float(1 - 4 * abs(t - 0.5))
            case "Saw": return Float(2 * t - 1)
            case "Square": return t < 0.5 ? 1 : -1
            case "Clear": return 0
            default: return Float(sin(2 * .pi * t))
            }
        }
    }

    func beginEdit() { previousWave = wave; canUndo = true }
    func finishEdit() {
        audio?.setWave(wave)
        if let data = try? JSONEncoder().encode(wave) {
            UserDefaults.standard.set(data, forKey: persistenceKey)
        }
        status = "Curve saved on this device. Hold a key to listen."
    }
    func choosePreset(_ name: String) {
        beginEdit()
        wave = Self.preset(name)
        finishEdit()
    }
    func undo() {
        guard let previousWave else { return }
        wave = previousWave
        self.previousWave = nil
        canUndo = false
        finishEdit()
    }
    func smooth() {
        beginEdit()
        let old = wave, n = wave.count
        wave = (0..<n).map { index -> Float in
            let left: Float = old[(index + n - 1) % n] * 0.25
            let center: Float = old[index] * 0.5
            let right: Float = old[(index + 1) % n] * 0.25
            return left + center + right
        }
        finishEdit()
    }

    func noteOn(_ midi: Int) {
        guard activeNote != midi else { return }
        tapTask?.cancel()
        do {
            if audio == nil { audio = try AudioController() }
            try audio?.start(wave: wave, volume: Float(volume))
            audio?.noteOn(midi)
            activeNote = midi
            error = nil
            status = "Playing · release the key to stop."
        } catch {
            self.error = error.localizedDescription
            stop()
        }
    }
    func noteOff(_ midi: Int) {
        guard activeNote == midi else { return }
        audio?.noteOff()
        activeNote = nil
        status = "Draw a cycle. Hold a key to hear it."
    }
    func accessibleTap(_ midi: Int) {
        noteOn(midi)
        tapTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            self?.noteOff(midi)
        }
    }
    func stop() {
        tapTask?.cancel()
        activeNote = nil
        audio?.stop()
        status = "Stopped. Hold a key when you’re ready."
    }
    func audioSystemChanged() {
        stop()
        audio = nil // Recreate AVAudioEngine after route or media-service changes.
    }
    func engineConfigurationChanged(_ notification: Notification) {
        if audio?.owns(notification) == true { audioSystemChanged() }
    }
}
