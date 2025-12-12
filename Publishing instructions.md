Also, what does it take to get this app on the Mac App Store? 

⏺ Getting on the Mac App Store requires a few things:

  What You Already Have

  - Apple Developer account ($99/year) ✓
  - Code signing ✓

  What's Needed for App Store

  1. App Store Connect Setup

  - Create an app record at https://appstoreconnect.apple.com
  - Fill out app metadata (description, screenshots, keywords, category)
  - Set pricing (free or paid)

  2. Additional Certificates

  You need different certificates for App Store vs direct distribution:
  - Mac App Distribution certificate (for signing the app)
  - Mac Installer Distribution certificate (for signing the .pkg)

  3. App Sandbox

  App Store apps must be sandboxed, which restricts what the app can do. This is the tricky part for
  OpenMarkdownReader because:
  - Need to request specific entitlements for file access
  - May need to use the system file picker for all file access
  - fs.watch() might need special handling

  4. Provisioning Profile

  - Create an App ID for the app
  - Create a Mac App Store provisioning profile

  5. Build Changes

  // Different target for App Store
  "target": [{ "target": "mas", "arch": ["universal"] }]

  6. Review Process

  - Apple reviews the app (can take 1-7 days)
  - May reject for various reasons and require fixes

  Effort Estimate

  - Easy parts: Certificates, App Store Connect setup, metadata (~1-2 hours)
  - Medium: Sandboxing and entitlements (~2-4 hours of testing)
  - Unknown: Review process (might pass first time, or might need iterations)

  Is It Worth It?

  Pros:
  - Discoverability, trust, auto-updates via App Store
  - Easy install for users

  Cons:
  - 15-30% cut of any revenue (if paid)
  - Sandboxing restrictions
  - Review delays for updates
  - Already have direct download working

  Would you like me to start setting it up? The direct GitHub release works well for now, so this could be a "nice to
   have" for later.

