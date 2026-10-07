import AVFoundation
import Foundation

// SwiftUI and the control side run on the main actor. The render callback only
// owns this stable handle and calls the C core, which never calls back into UI.
private final class SynthHandle: @unchecked Sendable {
    let pointer: OpaquePointer
    init() throws {
        guard let pointer = pc_create(48_000) else {
            throw NSError(domain: "PhosphorStudy", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Could not create the audio engine."])
        }
        self.pointer = pointer
    }
    deinit { pc_destroy(pointer) }
}

@MainActor
final class AudioController {
    private let handle: SynthHandle
    private let engine = AVAudioEngine()
    private let source: AVAudioSourceNode
    private var retryTask: Task<Void, Never>?

    init() throws {
        let handle = try SynthHandle()
        self.handle = handle
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!
        source = AVAudioSourceNode(format: format) { [handle] _, _, frameCount, buffers in
            let list = UnsafeMutableAudioBufferListPointer(buffers)
            guard let first = list.first, let data = first.mData else { return noErr }
            let output = data.assumingMemoryBound(to: Float.self)
            pc_render(handle.pointer, output, Int(frameCount))
            // The source format is mono, noninterleaved. Copy if the framework
            // supplies extra planar buffers; do not advance the oscillator twice.
            for buffer in list.dropFirst() {
                if let target = buffer.mData {
                    memcpy(target, data, Int(frameCount) * MemoryLayout<Float>.size)
                }
            }
            return noErr
        }
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: format)
        engine.mainMixerNode.outputVolume = 1
    }

    func start(wave: [Float], volume: Float) throws {
        if engine.isRunning { return }
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try session.setPreferredSampleRate(48_000)
        try session.setPreferredIOBufferDuration(0.005)
        try session.setActive(true)
        #endif
        pc_reset(handle.pointer)
        setWave(wave)
        setVolume(volume)
        engine.prepare()
        try engine.start()
    }

    func setWave(_ wave: [Float]) {
        retryTask?.cancel()
        // When stopped, consuming the queue here is safe and prevents edits made
        // before the first note from filling the producer queue.
        if !engine.isRunning { pc_reset(handle.pointer) }
        let accepted = wave.withUnsafeBufferPointer {
            pc_set_wave(handle.pointer, $0.baseAddress, $0.count) != 0
        }
        if !engine.isRunning { pc_reset(handle.pointer) }
        if !accepted {
            retryTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 20_000_000)
                guard !Task.isCancelled else { return }
                self?.setWave(wave)
            }
        }
    }

    func noteOn(_ midi: Int) {
        let frequency = Float(440 * pow(2, Double(midi - 69) / 12))
        pc_set_note(handle.pointer, frequency)
    }
    func noteOff() { pc_set_note(handle.pointer, 0) }
    func setVolume(_ value: Float) { pc_set_volume(handle.pointer, value) }
    func owns(_ notification: Notification) -> Bool {
        (notification.object as? AVAudioEngine) === engine
    }

    func stop() {
        retryTask?.cancel()
        noteOff()
        engine.stop()
        pc_reset(handle.pointer)
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    deinit {
        retryTask?.cancel()
        engine.stop()
        // source retains the handle until the framework has released the block.
    }
}
