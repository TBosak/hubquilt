import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifest: {
    name: "HubQuilt",
    description: "Modular, configurable enhancements for GitHub.",
    version: "0.0.1",
    permissions: ["storage"],
    // Developer info for Firefox submission
    developer: {
      name: "HubQuilt",
      url: "https://github.com/TBosak/hubquilt"
    },
    host_permissions: [
      "https://github.com/*",
      "https://gist.github.com/*",
      "https://api.github.com/*"
    ],
    icons: {
      16: "logo.png",
      48: "logo.png",
      128: "logo.png",
    },
    web_accessible_resources: [
      {
        resources: ["file-icons/css/*.css", "file-icons/fonts/*.woff2"],
        matches: ["https://github.com/*", "https://gist.github.com/*"]
      }
    ],
    // Firefox-specific settings
    browser_specific_settings: {
      gecko: {
        id: "timb63701@gmail.com",
        strict_min_version: "109.0",
        // @ts-ignore - WXT doesn't support this field yet
        data_collection_permissions: {
          required: ['none'],
        },
      }
    }
  },
  hooks: {
    "build:manifestGenerated": (wxt, manifest) => {
      // Force options to open in a new tab
      if (manifest.options_ui) {
        manifest.options_ui.open_in_tab = true;
      }
    },
  },
});