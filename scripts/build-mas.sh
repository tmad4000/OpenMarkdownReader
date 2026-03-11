#!/bin/bash
# Build, sign, and upload OpenMarkdownReader for Mac App Store / TestFlight
# Usage: ./scripts/build-mas.sh [--upload]
#
# How it works:
#   1. electron-builder packages + signs the app (fails at pkg step — that's OK)
#   2. We patch Info.plist (compliance key + unique build number)
#   3. productbuild creates the .pkg installer
#   4. Upload to App Store Connect
#   5. Auto-clear export compliance via API
#
# IMPORTANT: Do NOT use --deep or re-sign helpers after electron-builder.
# electron-builder's helper signing is correct. But we DO re-sign the main app
# after patching Info.plist, since modifying plist invalidates the code signature.
set -euo pipefail

UPLOAD=false
if [[ "${1:-}" == "--upload" ]]; then
    UPLOAD=true
fi

APP_DIR="dist/mas-arm64/OpenMarkdownReader.app"
INSTALLER_CERT="3rd Party Mac Developer Installer: IdeaFlow, Inc. (JESMXK96LG)"

echo "=== Step 1: Package + sign with electron-builder ==="
node scripts/generate-build-info.js
# electron-builder signs everything correctly but fails at the pkg step
# (can't find installer cert). That's fine — we use productbuild for the pkg.
npx electron-builder --mac mas 2>&1 || true

if [ ! -d "$APP_DIR" ]; then
    echo "ERROR: electron-builder failed to create app bundle"
    exit 1
fi

echo ""
echo "=== Step 2: Patch Info.plist ==="
# Ensure encryption compliance key is present
/usr/libexec/PlistBuddy -c "Delete :ITSAppUsesNonExemptEncryption" "$APP_DIR/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$APP_DIR/Contents/Info.plist"

# Epoch-based build number (always unique and increasing)
NEW_BUILD=$(date +%s)
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $NEW_BUILD" "$APP_DIR/Contents/Info.plist"
echo "  Build number: $NEW_BUILD"

echo ""
echo "=== Step 2b: Strip quarantine attributes ==="
# Downloaded files (e.g. provisioning profiles) get com.apple.quarantine which
# Apple rejects with ITMS-91109. Only strip quarantine (not all xattrs, which
# can invalidate code signatures).
xattr -dr com.apple.quarantine "$APP_DIR"
echo "  Quarantine attributes removed"

echo ""
echo "=== Step 2c: Re-sign main app (plist changes invalidated signature) ==="
# Only re-sign the top-level app bundle — NOT --deep (which would break helper signatures).
# Helpers keep their original electron-builder signatures.
DIST_CERT="Apple Distribution: IdeaFlow, Inc. (JESMXK96LG)"
codesign --force --sign "$DIST_CERT" \
    --entitlements build/entitlements.mas.plist \
    "$APP_DIR" 2>&1
echo "  Re-signed with $DIST_CERT"

echo ""
echo "=== Step 3: Build installer pkg ==="
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP_DIR/Contents/Info.plist")
PKG_NAME="dist/OpenMarkdownReader-${VERSION}-b${NEW_BUILD}.pkg"

productbuild --component "$APP_DIR" /Applications --sign "$INSTALLER_CERT" "$PKG_NAME" 2>&1
echo "  Package: $PKG_NAME"

if [ "$UPLOAD" = true ]; then
    echo ""
    echo "=== Step 4: Upload to App Store Connect ==="
    xcrun altool --upload-app \
        -f "$PKG_NAME" \
        -t macos \
        --apiKey "${APPLE_API_KEY_ID:-KWJX4896S5}" \
        --apiIssuer "${APPLE_API_ISSUER:-69a6de95-2833-47e3-e053-5b8c7c11a4d1}" \
        2>&1

    echo ""
    echo "=== Step 5: Clear export compliance via API ==="
    python3 - "$NEW_BUILD" << 'PYEOF'
import sys, jwt, time, json, urllib.request, urllib.error

build_version = sys.argv[1]

with open('/Users/jacobcole/.private_keys/AuthKey_KWJX4896S5.p8') as f:
    key = f.read()

now = int(time.time())
token = jwt.encode(
    {'iss': '69a6de95-2833-47e3-e053-5b8c7c11a4d1', 'iat': now, 'exp': now + 600, 'aud': 'appstoreconnect-v1'},
    key, algorithm='ES256', headers={'kid': 'KWJX4896S5'}
)
headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

# Wait for build to appear (processing takes a moment)
print(f"  Waiting for build {build_version} to process...")
for attempt in range(12):
    time.sleep(10)
    try:
        req = urllib.request.Request(
            f'https://api.appstoreconnect.apple.com/v1/builds?filter[app]=6758376669&filter[version]={build_version}&limit=1',
            headers={'Authorization': f'Bearer {token}'}
        )
        resp = urllib.request.urlopen(req)
        data = json.loads(resp.read())
        if data['data']:
            build = data['data'][0]
            state = build['attributes'].get('processingState')
            encryption = build['attributes'].get('usesNonExemptEncryption')
            print(f"  Build found: processing={state}, encryption={encryption}")
            if state == 'VALID' and encryption is None:
                # Clear compliance
                payload = json.dumps({
                    'data': {'type': 'builds', 'id': build['id'], 'attributes': {'usesNonExemptEncryption': False}}
                }).encode()
                req2 = urllib.request.Request(
                    f"https://api.appstoreconnect.apple.com/v1/builds/{build['id']}",
                    data=payload, headers=headers, method='PATCH'
                )
                urllib.request.urlopen(req2)
                print("  Compliance cleared!")
                break
            elif state == 'VALID' and encryption is not None:
                print("  Compliance already set.")
                break
            else:
                print(f"  Still processing (attempt {attempt+1}/12)...")
    except Exception as e:
        print(f"  Waiting... ({e})")
else:
    print("  Build not ready after 2 minutes. Clear compliance manually in App Store Connect.")
PYEOF
fi

echo ""
echo "=== Done ==="
if [ "$UPLOAD" = false ]; then
    echo "To upload: xcrun altool --upload-app -f $PKG_NAME -t macos --apiKey KWJX4896S5 --apiIssuer 69a6de95-2833-47e3-e053-5b8c7c11a4d1"
fi
