#!/usr/bin/env bash
#
# Builds Hearth.app — a native macOS shell around the interface.
#
# Needs only the Xcode Command Line Tools (`xcode-select --install`); there is no
# Xcode project, no CocoaPods, no npm involvement. The result is a normal .app
# bundle you can drag to /Applications.
#
#   ./macos/build.sh                 # build for this machine's architecture
#   ./macos/build.sh --universal     # arm64 + x86_64 in one binary
#
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="Hearth"
BUNDLE_ID="dev.hearth.tv"
VERSION="1.0.0"
OUT_DIR="dist-macos"
APP_DIR="$OUT_DIR/$APP_NAME.app"
MACOS_DIR="$APP_DIR/Contents/MacOS"
RES_DIR="$APP_DIR/Contents/Resources"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found. Install the Xcode Command Line Tools:" >&2
  echo "  xcode-select --install" >&2
  exit 1
fi

TARGETS=()
if [[ "${1:-}" == "--universal" ]]; then
  TARGETS=(-target arm64-apple-macos12.0 -target x86_64-apple-macos12.0)
  echo "Building a universal binary (arm64 + x86_64)"
else
  echo "Building for $(uname -m)"
fi

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RES_DIR"

echo "Compiling…"
if [[ ${#TARGETS[@]} -gt 0 ]]; then
  # swiftc cannot emit two architectures at once; build each, then lipo them.
  swiftc -O -target arm64-apple-macos12.0 -o "$OUT_DIR/hearth-arm64" macos/Hearth.swift
  swiftc -O -target x86_64-apple-macos12.0 -o "$OUT_DIR/hearth-x86_64" macos/Hearth.swift
  lipo -create -output "$MACOS_DIR/$APP_NAME" "$OUT_DIR/hearth-arm64" "$OUT_DIR/hearth-x86_64"
  rm -f "$OUT_DIR/hearth-arm64" "$OUT_DIR/hearth-x86_64"
else
  swiftc -O -o "$MACOS_DIR/$APP_NAME" macos/Hearth.swift
fi
chmod +x "$MACOS_DIR/$APP_NAME"

# ---------------------------------------------------------------------------
# Info.plist
#
# NSAppTransportSecurity matters: the app talks to a self-hosted server over
# plain HTTP on the local network, and WebKit blocks that by default. The
# exception is limited to local networking rather than opened globally.
# ---------------------------------------------------------------------------
cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.entertainment</string>

  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>

  <key>NSLocalNetworkUsageDescription</key>
  <string>Hearth streams video and music from media servers on your local network.</string>
  <key>NSBluetoothAlwaysUsageDescription</key>
  <string>Hearth reads button presses from a Bluetooth remote control.</string>
</dict>
</plist>
PLIST

# ---------------------------------------------------------------------------
# Icon: generated from the same flame mark the web interface uses, so there is
# one visual identity and no binary asset to keep in the repository.
# ---------------------------------------------------------------------------
if command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  echo "Generating the icon…"
  SVG="$OUT_DIR/icon.svg"
  cat > "$SVG" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1d1723"/><stop offset="1" stop-color="#08060a"/>
    </linearGradient>
    <linearGradient id="flame" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#fff6ea"/><stop offset="0.45" stop-color="#ffd0a1"/>
      <stop offset="1" stop-color="#e2762f"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="228" fill="url(#bg)"/>
  <ellipse cx="512" cy="700" rx="300" ry="150" fill="#e2762f" opacity="0.18"/>
  <path d="M512 190c150 128 236 224 236 356a236 236 0 0 1-472 0c0-132 86-228 236-356z" fill="url(#flame)"/>
  <path d="M512 396c72 66 112 116 112 184a112 112 0 0 1-224 0c0-68 40-118 112-184z" fill="#fff9f2" opacity="0.55"/>
</svg>
SVG
  ICONSET="$OUT_DIR/AppIcon.iconset"
  rm -rf "$ICONSET"; mkdir -p "$ICONSET"
  # qlmanage renders the SVG; fall back silently if it is unavailable.
  if qlmanage -t -s 1024 -o "$OUT_DIR" "$SVG" >/dev/null 2>&1 \
     && [[ -f "$OUT_DIR/icon.svg.png" ]]; then
    BASE="$OUT_DIR/icon.svg.png"
    for size in 16 32 64 128 256 512; do
      sips -z $size $size "$BASE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null 2>&1
      sips -z $((size*2)) $((size*2)) "$BASE" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null 2>&1
    done
    iconutil -c icns "$ICONSET" -o "$RES_DIR/AppIcon.icns" 2>/dev/null || true
    rm -f "$BASE"
  fi
  rm -rf "$ICONSET" "$SVG"
fi

# Ad-hoc signature. Without it, macOS refuses to run an unsigned bundle that was
# assembled locally; this is not a Developer ID signature and does not notarise.
codesign --force --deep --sign - "$APP_DIR" 2>/dev/null \
  && echo "Signed ad-hoc." \
  || echo "Could not sign; right-click → Open the first time."

echo ""
echo "Built $APP_DIR"
echo ""
echo "  Run it:            open $APP_DIR"
echo "  Point it anywhere: open -a $APP_DIR --args --url http://192.168.3.148:8788"
echo "  Windowed:          open -a $APP_DIR --args --windowed"
echo "  Install:           cp -R $APP_DIR /Applications/"
echo ""
