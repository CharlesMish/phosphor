import Foundation
import XCTest
@testable import PhosphorStudy

@MainActor
private final class MockInstrumentAudio: InstrumentAudioControlling {
    enum Failure: Error { case cannotStart }
    var failNextStart = false
    var starts = 0
    var playedNotes: [Int] = []
    var releases = 0
    var stops = 0
    var waves: [[Float]] = []
    var volumes: [Float] = []

    func start(wave: [Float], volume: Float) throws {
        starts += 1
        if failNextStart {
            failNextStart = false
            throw Failure.cannotStart
        }
        waves.append(wave)
        volumes.append(volume)
    }
    func setWave(_ wave: [Float]) { waves.append(wave) }
    func setVolume(_ volume: Float) { volumes.append(volume) }
    func noteOn(_ midi: Int) { playedNotes.append(midi) }
    func noteOff() { releases += 1 }
    func stop() { stops += 1 }
    func owns(_ notification: Notification) -> Bool { false }
}

@MainActor
final class InstrumentModelTests: XCTestCase {
    private let persistenceKey = "phosphor.cycle-study.wave.v1"

    private func withFixture(_ body: (InstrumentModel, MockInstrumentAudio, UserDefaults) -> Void) {
        let suite = "PhosphorModelTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let audio = MockInstrumentAudio()
        let model = InstrumentModel(defaults: defaults, makeAudio: { audio })
        defer {
            model.stop()
            defaults.removePersistentDomain(forName: suite)
        }
        body(model, audio, defaults)
    }

    func testReleasingLatestKeyReturnsToAnOlderHeldKey() {
        withFixture { model, audio, _ in
            let first = UUID(), second = UUID()
            model.noteOn(60, source: first)
            model.noteOn(64, source: second)
            XCTAssertEqual(model.activeNote, 64)
            model.noteOff(source: second)
            XCTAssertEqual(model.activeNote, 60)
            XCTAssertEqual(audio.playedNotes.last, 60)
            model.noteOff(source: first)
            XCTAssertNil(model.activeNote)
            XCTAssertGreaterThan(audio.releases, 0)
        }
    }

    func testOlderSamePitchReleaseCannotStopNewerTouch() {
        withFixture { model, audio, _ in
            let older = UUID(), newer = UUID()
            model.noteOn(69, source: older)
            model.noteOn(69, source: newer)
            let releases = audio.releases
            model.noteOff(source: older)
            XCTAssertEqual(model.activeNote, 69)
            XCTAssertEqual(audio.releases, releases)
            model.noteOff(source: newer)
            XCTAssertNil(model.activeNote)
        }
    }

    func testDuplicateGestureUpdatesDoNotStealAnotherHeldNote() {
        withFixture { model, audio, _ in
            let older = UUID(), newer = UUID()
            model.noteOn(60, source: older)
            model.noteOn(67, source: newer)
            let starts = audio.starts
            let notes = audio.playedNotes
            model.noteOn(60, source: older)
            XCTAssertEqual(model.activeNote, 67)
            XCTAssertEqual(audio.starts, starts)
            XCTAssertEqual(audio.playedNotes, notes)
        }
    }

    func testStopRejectsStillHeldGestureUntilItHasReleased() {
        withFixture { model, audio, _ in
            let held = UUID()
            model.noteOn(60, source: held)
            model.stop()
            let notes = audio.playedNotes
            model.noteOn(60, source: held)
            XCTAssertNil(model.activeNote)
            XCTAssertEqual(audio.playedNotes, notes)
            model.noteOff(source: held)
            model.noteOn(60, source: UUID())
            XCTAssertEqual(model.activeNote, 60)
        }
    }

    func testLateReleaseAfterStopCannotCutOffANewGesture() {
        withFixture { model, audio, _ in
            let old = UUID(), new = UUID()
            model.noteOn(60, source: old)
            model.stop()
            model.noteOn(60, source: new)
            let releases = audio.releases
            model.noteOff(source: old)
            XCTAssertEqual(model.activeNote, 60)
            XCTAssertEqual(audio.releases, releases)
        }
    }

    func testFailedAudioStartCanBeRetriedWithANewGesture() {
        withFixture { model, audio, _ in
            audio.failNextStart = true
            let failed = UUID()
            model.noteOn(64, source: failed)
            XCTAssertNil(model.activeNote)
            XCTAssertNotNil(model.error)
            model.noteOff(source: failed)
            model.noteOn(67, source: UUID())
            XCTAssertEqual(model.activeNote, 67)
            XCTAssertNil(model.error)
            XCTAssertEqual(audio.playedNotes, [67])
        }
    }

    func testDrawingPreviewDoesNotReachAudioOrStorageUntilCommitted() {
        withFixture { model, audio, defaults in
            model.noteOn(60, source: UUID())
            let original = model.wave
            let waveUpdates = audio.waves.count
            model.beginEdit()
            model.draw(from: nil, to: 10, value: -0.8)
            model.draw(from: (index: 10, value: -0.8), to: 20, value: 0.8)
            XCTAssertNotEqual(model.wave, original)
            XCTAssertEqual(model.wave[15], 0, accuracy: 0.00001)
            XCTAssertEqual(audio.waves.count, waveUpdates)
            XCTAssertNil(defaults.data(forKey: persistenceKey))
            model.finishEdit()
            XCTAssertEqual(audio.waves.last, model.wave)
            let saved = defaults.data(forKey: persistenceKey)
                .flatMap { try? JSONDecoder().decode([Float].self, from: $0) }
            XCTAssertEqual(saved, model.wave)
        }
    }

    func testFirstNoteDuringDrawingUsesLastCommittedCurve() {
        withFixture { model, audio, _ in
            let committed = model.wave
            model.beginEdit()
            model.draw(from: nil, to: 10, value: -0.8)
            XCTAssertNotEqual(model.wave, committed)
            model.noteOn(60, source: UUID())
            XCTAssertEqual(audio.waves.last, committed)
            model.cancelEdit()
            XCTAssertEqual(model.wave, committed)
            XCTAssertEqual(audio.waves.last, committed)
        }
    }

    func testCancelledDrawingRestoresCurveAndPreservesExistingUndo() {
        withFixture { model, _, defaults in
            let original = model.wave
            model.choosePreset("Saw")
            let committed = model.wave
            let saved = defaults.data(forKey: persistenceKey)
            model.beginEdit()
            model.draw(from: nil, to: 70, value: 0.9)
            model.cancelEdit()
            XCTAssertEqual(model.wave, committed)
            XCTAssertEqual(defaults.data(forKey: persistenceKey), saved)
            XCTAssertTrue(model.canUndo)
            model.undo()
            XCTAssertEqual(model.wave, original)
        }
    }

    func testNoOpEditPreservesUndoAndUndoPersistsTheRestoredCurve() {
        withFixture { model, _, defaults in
            let original = model.wave
            model.choosePreset("Square")
            model.beginEdit()
            model.finishEdit()
            XCTAssertTrue(model.canUndo)
            model.undo()
            XCTAssertEqual(model.wave, original)
            XCTAssertFalse(model.canUndo)
            let restored = InstrumentModel(defaults: defaults, makeAudio: { MockInstrumentAudio() })
            defer { restored.stop() }
            XCTAssertEqual(restored.wave, original)
        }
    }

    func testCorruptOrOutOfRangeSavedWaveFallsBackToSine() {
        withFixture { _, _, defaults in
            let invalidData = [
                Data("not JSON".utf8),
                try! JSONEncoder().encode([Float](repeating: 0, count: 255)),
                try! JSONEncoder().encode([Float](repeating: 1.2, count: 256))
            ]
            for data in invalidData {
                defaults.set(data, forKey: persistenceKey)
                let restored = InstrumentModel(defaults: defaults, makeAudio: { MockInstrumentAudio() })
                XCTAssertEqual(restored.wave, InstrumentModel.preset("Sine"))
                restored.stop()
            }
        }
    }

    func testFlatNonzeroCurveExplainsSilenceAfterDCRemoval() {
        withFixture { model, _, _ in
            model.beginEdit()
            model.draw(from: nil, to: 0, value: 0.5)
            model.draw(from: (index: 0, value: 0.5), to: 255, value: 0.5)
            model.finishEdit()
            model.noteOn(60, source: UUID())
            XCTAssertTrue(model.status.hasPrefix("Silent curve"))
        }
    }

    func testAccessibleTapTimeoutCannotReleaseNewerSamePitchTouch() async throws {
        let suite = "PhosphorModelTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let audio = MockInstrumentAudio()
        let model = InstrumentModel(defaults: defaults, makeAudio: { audio })
        defer {
            model.stop()
            defaults.removePersistentDomain(forName: suite)
        }
        model.accessibleTap(69)
        let touch = UUID()
        model.noteOn(69, source: touch)
        try await Task.sleep(nanoseconds: 550_000_000)
        XCTAssertEqual(model.activeNote, 69)
        model.noteOff(source: touch)
        XCTAssertNil(model.activeNote)
    }
}
