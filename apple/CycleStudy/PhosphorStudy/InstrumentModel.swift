import SwiftUI
import Foundation

// Keeping the main-actor control interface small makes input ownership and saved
// curves testable without opening an audio device.
@MainActor
protocol InstrumentAudioControlling: AnyObject {
    func start(wave: [Float], volume: Float) throws
    func setWave(_ wave: [Float])
    func setVolume(_ value: Float)
    func noteOn(_ midi: Int)
    func noteOff()
    func stop()
    func owns(_ notification: Notification) -> Bool
}

extension AudioController: InstrumentAudioControlling {}

@MainActor
final class InstrumentModel: ObservableObject {
    static let sampleCount = 256
    @Published private(set) var wave: [Float]
    @Published var volume: Double = 0.3 {
        didSet {
            volume = volume.isFinite ? min(1, max(0, volume)) : 0.3
            audio?.setVolume(Float(volume))
            if activeNote != nil { updatePlayingStatus() }
        }
    }
    @Published private(set) var activeNote: Int?
    @Published private(set) var status = "Draw a cycle. Hold a key to hear it."
    @Published private(set) var error: String?
    @Published private(set) var canUndo = false
    @Published private(set) var isEditing = false
    private var audio: (any InstrumentAudioControlling)?
    private let makeAudio: @MainActor () throws -> any InstrumentAudioControlling
    private let defaults: UserDefaults
    private var previousWave: [Float]?
    private var editStartWave: [Float]?
    private var heldNotes: [(source: UUID, midi: Int)] = []
    private var stoppedSources: Set<UUID> = []
    private var tapTask: Task<Void, Never>?
    private var tapSource: UUID?
    private let persistenceKey = "phosphor.cycle-study.wave.v1"

    init(defaults: UserDefaults = .standard,
         makeAudio: @escaping @MainActor () throws -> any InstrumentAudioControlling = { try AudioController() }) {
        self.defaults = defaults
        self.makeAudio = makeAudio
        if let data = defaults.data(forKey: persistenceKey) {
            if let saved = try? JSONDecoder().decode([Float].self, from: data),
               saved.count == Self.sampleCount, saved.allSatisfy({ $0.isFinite && abs($0) <= 1 }) {
                wave = saved
            } else {
                wave = Self.preset("Sine")
                status = "Saved curve couldn’t be read. Started with Sine."
            }
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

    func beginEdit() {
        guard !isEditing else { return }
        editStartWave = wave
        isEditing = true
    }
    func draw(from previous: (index: Int, value: Float)?, to index: Int, value: Float) {
        guard isEditing, wave.indices.contains(index), value.isFinite else { return }
        let sample = min(1, max(-1, value))
        if let previous, wave.indices.contains(previous.index), previous.value.isFinite,
           previous.index != index {
            let startValue = min(1, max(-1, previous.value))
            for i in min(previous.index, index)...max(previous.index, index) {
                let t = Float(i - previous.index) / Float(index - previous.index)
                wave[i] = startValue + t * (sample - startValue)
            }
        } else {
            wave[index] = sample
        }
    }
    func finishEdit() {
        guard let before = editStartWave else { return }
        editStartWave = nil
        isEditing = false
        guard wave != before else { return }
        previousWave = before
        canUndo = true
        applyAndSaveWave()
    }
    func cancelEdit() {
        guard let before = editStartWave else { return }
        wave = before
        editStartWave = nil
        isEditing = false
    }
    private func applyAndSaveWave() {
        audio?.setWave(wave)
        // All changes enter through bounded, finite samples. Keep any encoding
        // failure visible instead of claiming that the curve was saved.
        do {
            defaults.set(try JSONEncoder().encode(wave), forKey: persistenceKey)
            if activeNote == nil {
                status = "Curve saved on this device. Hold a key to listen."
            } else {
                updatePlayingStatus()
            }
        } catch {
            status = "Curve changed, but couldn’t be saved on this device."
        }
    }
    func choosePreset(_ name: String) {
        guard !isEditing else { return }
        beginEdit()
        wave = Self.preset(name)
        finishEdit()
    }
    func undo() {
        guard !isEditing, let previousWave else { return }
        wave = previousWave
        self.previousWave = nil
        canUndo = false
        applyAndSaveWave()
    }
    func smooth() {
        guard !isEditing else { return }
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

    // A source owns one press, rather than merely a MIDI number. This prevents
    // an older finger or an accessibility timer from releasing a newer note.
    func noteOn(_ midi: Int, source: UUID) {
        guard (0...127).contains(midi), !stoppedSources.contains(source),
              !heldNotes.contains(where: { $0.source == source }) else { return }
        heldNotes.append((source, midi))
        activate(midi)
    }
    private func activate(_ midi: Int) {
        guard activeNote != midi else { return }
        do {
            if audio == nil { audio = try makeAudio() }
            // An unfinished stroke is a visual preview. Even the first note
            // during that stroke hears the last committed curve until release.
            try audio?.start(wave: editStartWave ?? wave, volume: Float(volume))
            audio?.noteOn(midi)
            activeNote = midi
            error = nil
            updatePlayingStatus()
        } catch {
            self.error = error.localizedDescription
            stop()
            audio = nil
        }
    }
    func noteOff(source: UUID) {
        stoppedSources.remove(source)
        guard heldNotes.contains(where: { $0.source == source }) else { return }
        heldNotes.removeAll { $0.source == source }
        if let next = heldNotes.last {
            activate(next.midi)
        } else {
            audio?.noteOff()
            activeNote = nil
            status = "Draw a cycle. Hold a key to hear it."
        }
    }
    private func updatePlayingStatus() {
        let audibleWave = editStartWave ?? wave
        if volume == 0 {
            status = "Volume is zero · raise it to hear the note."
        } else if audibleWave.allSatisfy({ abs($0 - (audibleWave.first ?? 0)) < 0.000_001 }) {
            status = "Silent curve · choose a preset or draw to hear a note."
        } else {
            status = "Playing · release the key to stop."
        }
    }
    func accessibleTap(_ midi: Int) {
        tapTask?.cancel()
        if let tapSource { noteOff(source: tapSource) }
        let source = UUID()
        tapSource = source
        noteOn(midi, source: source)
        tapTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            self?.noteOff(source: source)
            if self?.tapSource == source { self?.tapSource = nil }
        }
    }
    func stop() {
        tapTask?.cancel()
        tapTask = nil
        stoppedSources.formUnion(heldNotes.map(\.source))
        if let tapSource { stoppedSources.remove(tapSource) }
        tapSource = nil
        heldNotes.removeAll()
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
