import SwiftUI
import AVFoundation
import Combine

private enum Ink {
    static let background = Color(red: 0.047, green: 0.075, blue: 0.078)
    static let panel = Color(red: 0.078, green: 0.114, blue: 0.114)
    static let mint = Color(red: 0.64, green: 0.94, blue: 0.77)
    static let muted = Color(red: 0.57, green: 0.67, blue: 0.64)
    static let paper = Color(red: 0.92, green: 0.94, blue: 0.87)
}

struct InstrumentView: View {
    @ObservedObject var model: InstrumentModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("PHOSPHOR").font(.system(size: 14, weight: .semibold, design: .monospaced)).tracking(4)
                        Text("A sound in your hand.").font(.system(size: 27, weight: .medium, design: .serif))
                    }
                    Spacer(minLength: 8)
                    Circle().fill(model.activeNote == nil ? Ink.muted.opacity(0.3) : Ink.mint)
                        .frame(width: 9, height: 9).padding(.top, 5)
                        .accessibilityLabel(model.activeNote == nil ? "Silent" : "Playing")
                }

                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        label("01 / DRAW ONE CYCLE")
                        Spacer()
                        Button("Undo", action: model.undo).disabled(!model.canUndo || model.isEditing)
                            .font(.system(size: 12, design: .monospaced))
                            .accessibilityIdentifier("undo-curve")
                    }
                    CycleEditor(model: model)
                        .frame(height: 210)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    Text("Trace across the panel. Your curve becomes a repeating sound when you lift your finger.")
                        .font(.system(size: 13)).foregroundStyle(Ink.muted)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { presetButtons }
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 8) { presetButton("Sine"); presetButton("Triangle"); presetButton("Saw") }
                            HStack(spacing: 8) { presetButton("Square"); presetButton("Clear"); smoothButton }
                        }
                    }
                    .disabled(model.isEditing)
                }

                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        label("02 / HOLD A NOTE")
                        Spacer()
                        Text("C4 — C5").font(.system(size: 11, design: .monospaced)).foregroundStyle(Ink.muted)
                    }
                    Piano(model: model).frame(height: 132)
                    HStack(spacing: 12) {
                        Image(systemName: "speaker.wave.1").foregroundStyle(Ink.muted).accessibilityHidden(true)
                        Slider(value: $model.volume, in: 0...1)
                            .tint(Ink.mint).accessibilityLabel("Volume")
                            .accessibilityValue("\(Int(model.volume * 100)) percent")
                        Button("Stop", action: model.stop)
                            .buttonStyle(.bordered).accessibilityIdentifier("stop-audio")
                            .keyboardShortcut(.escape, modifiers: [])
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    if let error = model.error {
                        Text("Audio couldn’t start: \(error)").foregroundStyle(.orange)
                    }
                    Text(model.status).foregroundStyle(Ink.muted)
                        .accessibilityIdentifier("instrument-status")
                    Text("CYCLE STUDY 01 · One voice · Your curve stays on this device")
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(Ink.muted.opacity(0.7))
                }.font(.system(size: 12))
            }
            .padding(24)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background(Ink.background)
        .foregroundStyle(Ink.paper)
        .tint(Ink.mint)
        .preferredColorScheme(.dark)
        .onChange(of: scenePhase) { phase in
            if phase != .active { model.cancelEdit(); model.stop() }
        }
        .onDisappear { model.cancelEdit(); model.stop() }
        // Audio-engine notifications may originate on an internal queue. Hop
        // before touching view state or releasing the old engine.
        .onReceive(NotificationCenter.default.publisher(for: .AVAudioEngineConfigurationChange).receive(on: RunLoop.main)) { notification in
            model.engineConfigurationChanged(notification)
        }
        #if os(iOS)
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification).receive(on: RunLoop.main)) { notification in
            if let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
               raw == AVAudioSession.InterruptionType.began.rawValue { model.stop() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification).receive(on: RunLoop.main)) { notification in
            guard let raw = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
            if reason == .oldDeviceUnavailable || reason == .newDeviceAvailable { model.audioSystemChanged() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.mediaServicesWereResetNotification).receive(on: RunLoop.main)) { _ in
            model.audioSystemChanged()
        }
        #endif
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.system(size: 11, weight: .medium, design: .monospaced))
            .tracking(1).foregroundStyle(Ink.muted)
    }
    @ViewBuilder private var presetButtons: some View {
        ForEach(["Sine", "Triangle", "Saw", "Square", "Clear"], id: \.self) { presetButton($0) }
        smoothButton
    }
    private func presetButton(_ name: String) -> some View {
        Button(name) { model.choosePreset(name) }
            .buttonStyle(.bordered).font(.system(size: 12))
            .fixedSize(horizontal: true, vertical: false)
            .accessibilityIdentifier("preset-\(name.lowercased())")
    }
    private var smoothButton: some View {
        Button("Smooth", action: model.smooth).buttonStyle(.bordered).font(.system(size: 12))
            .fixedSize(horizontal: true, vertical: false)
            .accessibilityIdentifier("smooth-curve")
    }
}

private struct CycleEditor: View {
    @ObservedObject var model: InstrumentModel
    @State private var last: (index: Int, value: Float)?
    @GestureState private var drawing = false

    var body: some View {
        GeometryReader { geometry in
            Canvas { context, size in
                context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Ink.panel))
                var grid = Path()
                for i in 1..<8 {
                    let x = size.width * CGFloat(i) / 8
                    grid.move(to: CGPoint(x: x, y: 0)); grid.addLine(to: CGPoint(x: x, y: size.height))
                }
                for i in 1..<4 {
                    let y = size.height * CGFloat(i) / 4
                    grid.move(to: CGPoint(x: 0, y: y)); grid.addLine(to: CGPoint(x: size.width, y: y))
                }
                context.stroke(grid, with: .color(Ink.muted.opacity(0.12)), lineWidth: 1)
                var axis = Path()
                axis.move(to: CGPoint(x: 0, y: size.height / 2))
                axis.addLine(to: CGPoint(x: size.width, y: size.height / 2))
                context.stroke(axis, with: .color(Ink.muted.opacity(0.32)), style: StrokeStyle(lineWidth: 1, dash: [3, 5]))
                var curve = Path()
                for (index, sample) in model.wave.enumerated() {
                    let point = CGPoint(x: CGFloat(index) / CGFloat(model.wave.count - 1) * size.width,
                                        y: (0.5 - CGFloat(sample) * 0.44) * size.height)
                    if index == 0 { curve.move(to: point) } else { curve.addLine(to: point) }
                }
                context.stroke(curve, with: .color(Ink.mint.opacity(0.08)), lineWidth: 9)
                context.stroke(curve, with: .color(Ink.mint), style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .updating($drawing) { _, state, _ in state = true }
                .onChanged { value in
                    guard value.location.x.isFinite, value.location.y.isFinite else { return }
                    if last == nil { model.beginEdit() }
                    // A scene change can cancel the model's edit before this
                    // gesture releases. Do not silently begin a second stroke.
                    guard model.isEditing else { return }
                    let width = max(1, geometry.size.width), height = max(1, geometry.size.height)
                    let position = min(1, max(0, value.location.x / width))
                    let index = Int((position * CGFloat(model.wave.count - 1)).rounded())
                    let sample = Float(min(1, max(-1, (0.5 - value.location.y / height) / 0.44)))
                    model.draw(from: last, to: index, value: sample)
                    last = (index, sample)
                }
                .onEnded { _ in
                    guard last != nil else { return }
                    last = nil
                    model.finishEdit()
                })
            .accessibilityLabel("Draw one waveform cycle")
            .accessibilityHint("Drag to change the waveform. Preset buttons offer accessible starting shapes.")
            .accessibilityIdentifier("cycle-editor")
            .onChange(of: drawing) { active in
                if !active && last != nil { last = nil; model.cancelEdit() }
            }
            .onDisappear {
                if last != nil { last = nil; model.cancelEdit() }
            }
        }
    }
}

private struct Piano: View {
    @ObservedObject var model: InstrumentModel
    private let whites = [60, 62, 64, 65, 67, 69, 71, 72]
    private let blacks = [(61, 0), (63, 1), (66, 3), (68, 4), (70, 5)]
    private let names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width / 8
            ZStack(alignment: .topLeading) {
                HStack(spacing: 3) {
                    ForEach(whites, id: \.self) { note in
                        key(note, black: false).frame(maxWidth: .infinity).frame(height: 130)
                    }
                }
                ForEach(blacks, id: \.0) { item in
                    key(item.0, black: true)
                        .frame(width: width * 0.6, height: 80)
                        .offset(x: CGFloat(item.1 + 1) * width - width * 0.3)
                }
            }
        }
    }
    private func key(_ note: Int, black: Bool) -> some View {
        PianoKey(model: model, note: note, black: black,
                 name: names[note % 12] + String(note / 12 - 1))
    }
}

private struct PianoKey: View {
    @ObservedObject var model: InstrumentModel
    let note: Int
    let black: Bool
    let name: String
    @GestureState private var pressed = false
    @State private var pressSource: UUID?

    var body: some View {
        let playing = model.activeNote == note
        return VStack {
            Spacer()
            Text(name).font(.system(size: black ? 9 : 11, weight: .medium, design: .monospaced)).padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity)
        .background(playing ? Ink.mint : (black ? Ink.background : Ink.paper))
        .foregroundStyle(playing || !black ? Ink.background : Ink.muted)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Ink.muted.opacity(0.25), lineWidth: black ? 1 : 0))
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0)
            .updating($pressed) { _, state, _ in state = true }
            .onChanged { _ in
                guard pressSource == nil else { return }
                let source = UUID()
                pressSource = source
                model.noteOn(note, source: source)
            }
            .onEnded { _ in release() })
        .onChange(of: pressed) { active in if !active { release() } }
        .onDisappear { release() }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name), play note")
        .accessibilityValue(playing ? "Playing" : "Released")
        .accessibilityHint("Activate for a short note.")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { model.accessibleTap(note) }
        .accessibilityIdentifier("note-\(note)")
    }

    private func release() {
        guard let source = pressSource else { return }
        pressSource = nil
        model.noteOff(source: source)
    }
}
