import AppKit
import WebKit

// ---------------------------------------------------------------------------
// Hearth for macOS
//
// A native shell around the Hearth interface. It exists for three reasons that a
// browser tab cannot satisfy:
//
//  1. Immersive fullscreen with no tab strip, no URL bar and no chrome of any
//     kind — a television should not look like a web page.
//  2. Key handling before the web view. A remote's Back button often arrives as
//     Escape, which a browser treats as "leave fullscreen"; here it is forwarded
//     to the interface instead.
//  3. No accidental navigation. There is no way to type a URL, reload into
//     something else, or right-click.
//
// What it deliberately does NOT claim to fix: the volume and power keys. macOS
// consumes those in the HID subsystem before any application is consulted, so no
// process — native or otherwise — can intercept them. Use WebHID or the app's
// own volume control instead.
// ---------------------------------------------------------------------------

/// Where the interface is loaded from, in priority order:
///   1. `--url <address>` on the command line
///   2. the `HEARTH_URL` environment variable
///   3. a locally-running self-hosted server
///   4. the hosted deployment
enum Config {
    static let fallbackLocal = "http://localhost:8788"
    static let fallbackHosted = "https://hearth-tv.liangjiaxin8.workers.dev"

    static func resolveURL() -> URL {
        let args = CommandLine.arguments
        if let index = args.firstIndex(of: "--url"), index + 1 < args.count,
           let url = URL(string: args[index + 1]) {
            return url
        }
        if let env = ProcessInfo.processInfo.environment["HEARTH_URL"],
           let url = URL(string: env) {
            return url
        }
        return URL(string: fallbackLocal)!
    }

    static var startFullscreen: Bool {
        !CommandLine.arguments.contains("--windowed")
    }
}

final class TVWebView: WKWebView {
    /// Suppress the right-click menu entirely: a remote's Menu button must not
    /// open a document context menu.
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        menu.removeAllItems()
    }

    override var acceptsFirstResponder: Bool { true }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: TVWebView!
    private var statusLabel: NSTextField!
    private let targetURL = Config.resolveURL()
    private var didTryLocalFallback = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        load(targetURL)
        if Config.startFullscreen {
            // Deferred: the window must be on screen before it can go fullscreen.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
                self?.window.toggleFullScreen(nil)
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // MARK: - Window

    private func buildWindow() {
        let screen = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1600, height: 900)
        let size = NSRect(x: 0, y: 0, width: min(1600, screen.width * 0.9),
                          height: min(950, screen.height * 0.9))

        window = NSWindow(
            contentRect: size,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Hearth"
        window.center()
        window.setFrameAutosaveName("HearthMainWindow")
        window.minSize = NSSize(width: 900, height: 560)

        // The window chrome dissolves into the interface: no title text, and a
        // background that matches the app's own so there is never a light flash.
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.backgroundColor = NSColor(srgbRed: 0.031, green: 0.023, blue: 0.039, alpha: 1)
        window.isMovableByWindowBackground = true
        window.collectionBehavior = [.fullScreenPrimary, .managed]
        window.appearance = NSAppearance(named: .darkAqua)

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsAirPlayForMediaPlayback = true
        config.suppressesIncrementalRendering = false
        config.websiteDataStore = .default()
        config.preferences.setValue(true, forKey: "fullScreenEnabled")
        config.preferences.isElementFullscreenEnabled = true

        webView = TVWebView(frame: size, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = false
        webView.setValue(false, forKey: "drawsBackground")
        // Advertised so the web app can tell it is inside the native shell and
        // leave fullscreen management alone. See `isNativeShell()` in the client.
        webView.customUserAgent = defaultUserAgent() + " HearthShell/1.0"

        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)

        buildStatusLabel()
        installKeyMonitor()
    }

    private func defaultUserAgent() -> String {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        return "Mozilla/5.0 (Macintosh; Intel Mac OS X \(version.majorVersion)_\(version.minorVersion)) "
            + "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    }

    /// Shown only when the interface cannot be reached, so a blank window never
    /// leaves the user guessing.
    private func buildStatusLabel() {
        statusLabel = NSTextField(labelWithString: "")
        statusLabel.alignment = .center
        statusLabel.font = .systemFont(ofSize: 15, weight: .regular)
        statusLabel.textColor = NSColor(srgbRed: 0.97, green: 0.94, blue: 0.91, alpha: 0.75)
        statusLabel.maximumNumberOfLines = 6
        statusLabel.isHidden = true
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        webView.addSubview(statusLabel)
        NSLayoutConstraint.activate([
            statusLabel.centerXAnchor.constraint(equalTo: webView.centerXAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: webView.centerYAnchor),
            statusLabel.widthAnchor.constraint(lessThanOrEqualTo: webView.widthAnchor, multiplier: 0.7),
        ])
    }

    // MARK: - Loading

    private func load(_ url: URL) {
        statusLabel.isHidden = true
        webView.load(URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData))
    }

    private func showStatus(_ text: String) {
        statusLabel.stringValue = text
        statusLabel.isHidden = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadFailure(error)
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        handleLoadFailure(error)
    }

    /// If a local server is not running, fall back to the hosted deployment once
    /// and say so, rather than showing an empty window.
    private func handleLoadFailure(_ error: Error) {
        let isLocal = targetURL.host == "localhost" || targetURL.host == "127.0.0.1"
        if isLocal && !didTryLocalFallback {
            didTryLocalFallback = true
            showStatus("""
            No local Hearth server on \(targetURL.absoluteString).
            Falling back to the hosted version…
            """)
            if let hosted = URL(string: Config.fallbackHosted) {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
                    self?.load(hosted)
                }
            }
            return
        }
        showStatus("""
        Could not load Hearth.

        \(error.localizedDescription)

        Start the local server, or launch with:
        open -a Hearth --args --url https://your-hearth-address
        """)
    }

    // MARK: - Keys

    /**
     Forwards keys to the web view before AppKit acts on them.

     Escape is the important one: a remote's Back button usually arrives as
     Escape, and AppKit would use it to exit fullscreen. Swallowing it here and
     letting the web view handle it keeps Back meaning "go back".
     */
    private func installKeyMonitor() {
        NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            let hasCommand = event.modifierFlags.contains(.command)

            // Keep the handful of shortcuts that should still work.
            if hasCommand, let chars = event.charactersIgnoringModifiers {
                switch chars.lowercased() {
                case "q", "w", "m", "h", "r", "f": return event
                default: return event
                }
            }

            // Escape (keyCode 53) must reach the interface, not AppKit.
            if event.keyCode == 53 {
                self.webView.evaluateJavaScript(
                    "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));"
                    + "window.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Escape',bubbles:true}));"
                )
                return nil
            }
            return event
        }
    }

    // MARK: - Menu

    private func buildMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Hearth", action: nil, keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        appMenu.addItem(withTitle: "Enter Full Screen",
                        action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Hearth",
                        action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Hearth",
                        action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        mainMenu.addItem(appItem)

        NSApp.mainMenu = mainMenu
    }

    @objc private func reload() {
        webView.reloadFromOrigin()
    }
}

// ---------------------------------------------------------------------------

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
