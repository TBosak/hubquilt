# HubQuilt - GitHub Enhancement Suite

A modular, configurable browser extension that adds enhancements to GitHub, built with [WXT](https://wxt.dev/).

## Features

- **Modular Architecture**: Features are self-contained modules that can be toggled on/off
- **Page Type Detection**: Automatically detects GitHub page types (repo, issue, PR, etc.)
- **Optional GitHub PAT Support**: Advanced features can leverage GitHub API with optional personal access token
- **Feature Toggle UI**: Easy-to-use options page to enable/disable features
- **Sample Features Included**:
  - Highlight repo name with a badge
  - Display GitHub API rate limit indicator (requires PAT)

## Development

### Prerequisites

- Node.js (v18 or later recommended)
- npm, pnpm, or bun

### Setup

```bash
# Install dependencies
npm install

# Development (Chrome by default)
npm run dev

# Development for Firefox
npm run dev:firefox

# Build for production
npm run build              # Chrome only (default)
npm run build:chrome       # Chrome specifically
npm run build:firefox      # Firefox specifically
npm run build:edge         # Edge specifically
npm run build:all          # All browsers (Chrome, Firefox, Edge)

# Create distribution zips
npm run zip                # Chrome only
npm run zip:all            # All browsers
```

### Project Structure

```
src/
├── entrypoints/
│   ├── content/
│   │   └── github.ts          # Content script entry point
│   └── options/
│       └── index.html         # Options page
├── core/
│   ├── feature-types.ts       # Type definitions
│   ├── feature-registry.ts    # Feature management
│   ├── github-page-detect.ts  # Page type detection
│   └── github-api-client.ts   # GitHub API client
├── features/
│   ├── sample-highlight-repo-name.ts
│   └── sample-api-based-feature.ts
└── ui/
    └── options-ui.ts          # Options page logic
```

## Loading the Extension

### Chrome/Chromium

1. Run `npm run build:chrome` (or `npm run build`)
2. Open `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `.output/chrome-mv3` directory

### Firefox

1. Run `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select any file in the `.output/firefox-mv3` directory

### Edge

1. Run `npm run build:edge`
2. Open `edge://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `.output/edge-mv3` directory

## GitHub PAT Configuration

Some features require a GitHub Personal Access Token (PAT) for enhanced functionality:

1. Open the extension options page
2. Generate a PAT at https://github.com/settings/tokens with appropriate scopes
3. Paste the token in the options page
4. Click "Save token"

**Security Note**: The PAT is stored locally in your browser using `chrome.storage.local` and is never sent to external servers (only to GitHub API).

## Adding New Features

Create a new file in `src/features/` that implements the `Feature` interface:

```typescript
import type { Feature } from "../core/feature-types";

export const myFeature: Feature = {
  id: "my-feature",
  name: "My Feature",
  description: "Description of what it does",
  tags: ["ui", "enhancement"],
  pageTypes: ["repo", "issue"],
  isEnabledByDefault: true,

  init(ctx) {
    // Your feature implementation
    const { document, pageType, repo, storage, githubApi } = ctx;
    // ...
  },
};
```

Then register it in `src/core/feature-registry.ts`:

```typescript
import { myFeature } from "../features/my-feature";

const ALL_FEATURES: Feature[] = [
  // ... existing features
  myFeature,
];
```

## License

ISC
