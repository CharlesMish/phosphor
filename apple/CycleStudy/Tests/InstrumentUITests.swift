import XCTest

final class InstrumentUITests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    func testDrawPlayReleaseAndStop() throws {
        let app = XCUIApplication()
        app.launch()
        let editor = app.descendants(matching: .any)["cycle-editor"].firstMatch
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        app.buttons["preset-sine"].tap()
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.75))
            .press(forDuration: 0.05, thenDragTo: editor.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.2)))
        XCTAssertTrue(app.staticTexts["Curve saved on this device. Hold a key to listen."].exists)
        app.buttons["note-69"].press(forDuration: 0.5)
        XCTAssertTrue(app.staticTexts["Draw a cycle. Hold a key to hear it."].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Audio couldn’t start:")).firstMatch.exists)
        app.buttons["stop-audio"].tap()
        XCTAssertTrue(app.staticTexts["Stopped. Hold a key when you’re ready."].exists)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Drawn curve on iPhone"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
