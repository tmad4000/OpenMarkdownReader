#!/bin/bash
# Build, sign, and upload OpenMarkdownReader for Mac App Store / TestFlight
# Usage: ./scripts/build-mas.sh [--upload]
set -euo pipefail

UPLOAD=false
if [[ "${1:-}" == "--upload" ]]; then
    UPLOAD=true
fi

APP_DIR="dist/mas-arm64/OpenMarkdownReader.app"
DIST_CERT="Apple Distribution: IdeaFlow, Inc. (JESMXK96LG)"
INSTALLER_CERT="3rd Party Mac Developer Installer: IdeaFlow, Inc. (JESMXK96LG)"
TEAM_ID="JESMXK96LG"
ENTITLEMENTS_MAIN="build/entitlements.mas.plist"
PROFILES_DIR="build/provisionprofiles"
TEMP_DIR=$(mktemp -d)

echo "=== Step 1: Package with electron-builder ==="
node scripts/generate-build-info.js
# Use electron-builder just for packaging (it will fail at pkg signing, that's ok)
npx electron-builder --mac mas --config.mac.identity="$DIST_CERT" 2>&1 || true

if [ ! -d "$APP_DIR" ]; then
    echo "ERROR: electron-builder failed to create app bundle"
    exit 1
fi

echo ""
echo "=== Step 2: Patch Info.plist ==="
/usr/libexec/PlistBuddy -c "Delete :ITSAppUsesNonExemptEncryption" "$APP_DIR/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$APP_DIR/Contents/Info.plist"

# Epoch-based build number (always unique and increasing)
NEW_BUILD=$(date +%s)
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $NEW_BUILD" "$APP_DIR/Contents/Info.plist"
echo "  Build number: $NEW_BUILD"

echo ""
echo "=== Step 3: Embed provisioning profiles ==="
cp build/embedded.provisionprofile "$APP_DIR/Contents/embedded.provisionprofile"
echo "  Main app: embedded"

embed_helper() {
    local helper_dir="$1"
    local profile_file="$2"
    if [ -d "$helper_dir" ]; then
        cp "$PROFILES_DIR/$profile_file" "$helper_dir/Contents/embedded.provisionprofile"
        echo "  $(basename "$helper_dir"): embedded"
    else
        echo "  WARNING: $(basename "$helper_dir") not found"
    fi
}

embed_helper "$APP_DIR/Contents/Frameworks/OpenMarkdownReader Helper.app" "helper.provisionprofile"
embed_helper "$APP_DIR/Contents/Frameworks/OpenMarkdownReader Helper (GPU).app" "helper.GPU.provisionprofile"
embed_helper "$APP_DIR/Contents/Frameworks/OpenMarkdownReader Helper (Plugin).app" "helper.Plugin.provisionprofile"
embed_helper "$APP_DIR/Contents/Frameworks/OpenMarkdownReader Helper (Renderer).app" "helper.Renderer.provisionprofile"
embed_helper "$APP_DIR/Contents/Library/LoginItems/OpenMarkdownReader Login Helper.app" "loginhelper.provisionprofile"

echo ""
echo "=== Step 4: Generate per-helper entitlements ==="

# Each helper needs entitlements with its own application-identifier
generate_helper_entitlements() {
    local bundle_id="$1"
    local output_file="$2"
    cat > "$output_file" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.application-identifier</key>
    <string>${TEAM_ID}.${bundle_id}</string>
    <key>com.apple.developer.team-identifier</key>
    <string>${TEAM_ID}</string>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.inherit</key>
    <true/>
</dict>
</plist>
PLISTEOF
    echo "  Generated: $bundle_id -> $output_file"
}

generate_helper_entitlements "com.jacobcole.openmarkdownreader.helper" "$TEMP_DIR/helper.plist"
generate_helper_entitlements "com.jacobcole.openmarkdownreader.helper.GPU" "$TEMP_DIR/helper.GPU.plist"
generate_helper_entitlements "com.jacobcole.openmarkdownreader.helper.Plugin" "$TEMP_DIR/helper.Plugin.plist"
generate_helper_entitlements "com.jacobcole.openmarkdownreader.helper.Renderer" "$TEMP_DIR/helper.Renderer.plist"
generate_helper_entitlements "com.jacobcole.openmarkdownreader.loginhelper" "$TEMP_DIR/loginhelper.plist"

echo ""
echo "=== Step 5: Sign all components (innermost to outermost, NO --deep) ==="

# Sign dylibs (no entitlements needed for dylibs)
echo "  Signing dylibs..."
find "$APP_DIR/Contents/Frameworks" -name "*.dylib" -exec \
    codesign --force --sign "$DIST_CERT" {} \; 2>&1

# Sign framework
echo "  Signing Electron framework..."
codesign --force --sign "$DIST_CERT" "$APP_DIR/Contents/Frameworks/Electron Framework.framework" 2>&1

# Sign each helper with its own entitlements (NOT --deep, sign explicitly)
echo "  Signing helpers with per-helper entitlements..."
sign_helper() {
    local helper_dir="$1"
    local entitlements="$2"
    if [ -d "$helper_dir" ]; then
        codesign --force --sign "$DIST_CERT" --entitlements "$entitlements" "$helper_dir" 2>&1
        echo "    $(basename "$helper_dir"): signed"
    fi
}

sign_helper "$APP_DIR/Contents/Frameworks/OpenMarkdownReader Helper.app" "$TEMP_DIR/helper.plist"
sign_helper "$APP_DIR/Contents/Frameworks/OpenMarkdownReader Helper (GPU).app" "$TEMP_DIR/helper.GPU.plist"
sign_helper "$APP_DIR/Contents/Frameworks/OpenMarkdownReader Helper (Plugin).app" "$TEMP_DIR/helper.Plugin.plist"
sign_helper "$APP_DIR/Contents/Frameworks/OpenMarkdownReader Helper (Renderer).app" "$TEMP_DIR/helper.Renderer.plist"
sign_helper "$APP_DIR/Contents/Library/LoginItems/OpenMarkdownReader Login Helper.app" "$TEMP_DIR/loginhelper.plist"

# Sign main app last (NOT --deep, so it doesn't re-sign helpers)
echo "  Signing main app..."
codesign --force --sign "$DIST_CERT" --entitlements "$ENTITLEMENTS_MAIN" "$APP_DIR" 2>&1

echo ""
echo "=== Step 6: Verify ==="
codesign --verify --deep --strict "$APP_DIR" 2>&1 && echo "  Signature: VALID" || echo "  Signature: INVALID"

# Verify each helper has correct app-id in entitlements
echo "  Entitlement check:"
for app in "$APP_DIR"/Contents/Frameworks/*.app "$APP_DIR"/Contents/Library/LoginItems/*.app; do
    name=$(basename "$app")
    app_id=$(codesign -d --entitlements - "$app" 2>&1 | grep -A1 "application-identifier" | grep String | sed 's/.*\[String\] //' || echo "NONE")
    has_profile="NO"
    [ -f "$app/Contents/embedded.provisionprofile" ] && has_profile="YES"
    echo "    $name: app-id=$app_id profile=$has_profile"
done

echo ""
echo "=== Step 7: Build installer pkg ==="
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP_DIR/Contents/Info.plist")
PKG_NAME="dist/OpenMarkdownReader-${VERSION}-b${NEW_BUILD}.pkg"

productbuild --component "$APP_DIR" /Applications --sign "$INSTALLER_CERT" "$PKG_NAME" 2>&1
echo "  Package: $PKG_NAME"

if [ "$UPLOAD" = true ]; then
    echo ""
    echo "=== Step 8: Upload to App Store Connect ==="
    xcrun altool --upload-app \
        -f "$PKG_NAME" \
        -t macos \
        --apiKey "${APPLE_API_KEY_ID:-KWJX4896S5}" \
        --apiIssuer "${APPLE_API_ISSUER:-69a6de95-2833-47e3-e053-5b8c7c11a4d1}" \
        2>&1
fi

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "=== Done ==="
echo "To upload manually: xcrun altool --upload-app -f $PKG_NAME -t macos --apiKey KWJX4896S5 --apiIssuer 69a6de95-2833-47e3-e053-5b8c7c11a4d1"
