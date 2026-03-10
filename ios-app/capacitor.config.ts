import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jacobcole.openmarkdownreader',
  appName: 'OpenMarkdownReader',
  webDir: 'www',
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: true,
    scrollEnabled: true,
    backgroundColor: '#f4f1ec',
    preferredContentMode: 'mobile'
  },
  plugins: {
    App: {
      // Allow opening .md files via share sheet
    },
    Filesystem: {
      // File access
    },
    Clipboard: {
      // Copy/paste
    },
    Browser: {
      // External links
    },
    Share: {
      // Share sheet
    }
  }
};

export default config;
