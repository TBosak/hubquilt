# Contributing to HubQuilt

Thank you for your interest in contributing to HubQuilt! This guide will help you get started.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Creating a New Feature](#creating-a-new-feature)
- [Code Style Guidelines](#code-style-guidelines)
- [Testing Your Changes](#testing-your-changes)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Feature Guidelines](#feature-guidelines)

## Getting Started

HubQuilt is a modular Chrome extension that enhances GitHub's UI. Features are self-contained modules that can be enabled/disabled independently.

### Prerequisites

- Node.js 18+ and npm
- Chrome browser
- Basic knowledge of TypeScript, DOM manipulation, and Chrome Extensions

## Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/tbosak/hubquilt.git
   cd hubquilt
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build:chrome
   ```

4. **Load in Chrome**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `.output/chrome-mv3` directory

5. **Start development mode** (auto-rebuild on changes)
   ```bash
   npm run dev:chrome
   ```

## Creating a New Feature

### Step 1: Create the Feature File

Create a new file in `src/features/` following this structure:

```typescript
// src/features/my-feature.ts
import type { Feature } from "../core/feature-types";
import { observeAndProcess } from "../core/dom-observer";
import { injectStyles } from "../core/dom-utils";

export const myFeature: Feature = {
  // Unique identifier (kebab-case)
  id: "my-feature",

  // Display name shown in settings
  name: "My Feature",

  // Description shown in settings
  description: "Brief description of what this feature does and why it's useful.",

  // Tags for categorization (see Tag Guidelines below)
  tags: ["ui", "productivity"],

  // Which GitHub pages this feature runs on
  // Options: "repo", "code", "issue", "pull", "pull-list", "issue-list", "notifications", "profile", "unknown"
  pageTypes: ["repo", "code"],

  // Whether enabled by default for new users
  isEnabledByDefault: false,

  // Set to true if feature requires GitHub Personal Access Token
  requiresPAT: false,

  // Optional: Feature configuration options
  options: [
    {
      key: "myOption",
      label: "My Option",
      description: "What this option controls",
      type: "boolean", // "text" | "number" | "boolean" | "select" | "color"
      defaultValue: true,
    }
  ],

  // Initialization function - runs when feature is enabled
  async init(ctx, settings) {
    const { document, location, pageType, repo, storage, githubApi } = ctx;

    // Your feature logic here

    // Example: Observe DOM changes and process elements
    observeAndProcess(
      ['.css-selector-to-watch'], // Selectors to observe
      (element) => {
        // Process each matching element
        element.style.backgroundColor = 'lightblue';
      }
    );

    // Example: Inject custom CSS
    injectStyles(`
      .my-custom-class {
        color: red;
      }
    `, "my-feature-styles");
  }
};
```

### Step 2: Register the Feature

Add your feature to the registry in `src/core/feature-registry.ts`:

```typescript
// Add import at top
import { myFeature } from "../features/my-feature";

// Add to ALL_FEATURES array
const ALL_FEATURES: Feature[] = [
  apiLimit,
  codeColorsFeature,
  // ... other features
  myFeature, // Add your feature here
];
```

### Step 3: Test Your Feature

1. Build the extension: `npm run build:chrome`
2. Reload the extension in Chrome
3. Navigate to the extension options page
4. Enable your feature and test it on GitHub

## Code Style Guidelines

### TypeScript

- Use TypeScript for all new code
- Prefer interfaces over types for object shapes
- Use explicit return types for public functions
- Avoid `any` - use `unknown` if type is truly unknown

```typescript
// Good
async function fetchData(url: string): Promise<UserData> {
  const response = await fetch(url);
  return response.json();
}

// Bad
async function fetchData(url) {
  return fetch(url).then(r => r.json());
}
```

### Naming Conventions

- **Features**: `camelCaseFeature` (e.g., `fileDownloadsFeature`)
- **Feature IDs**: `kebab-case` (e.g., `file-downloads`)
- **Functions**: `camelCase` (e.g., `processElement`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `CACHE_DURATION`)
- **Interfaces**: `PascalCase` (e.g., `FeatureContext`)

### DOM Manipulation

- Use `querySelector` and `querySelectorAll` over jQuery-style selectors
- Always check if elements exist before manipulating them
- Clean up event listeners if the feature can be disabled
- Use `WeakSet` to track processed elements to avoid duplicates

```typescript
const processedElements = new WeakSet<Element>();

function processElement(element: Element) {
  if (processedElements.has(element)) {
    return; // Already processed
  }

  // Process element
  element.classList.add('my-class');

  // Mark as processed
  processedElements.add(element);
}
```

### Error Handling

- Always wrap feature logic in try-catch
- Log errors with feature name prefix
- Fail gracefully - don't break other features

```typescript
async init(ctx, settings) {
  try {
    // Feature logic
  } catch (error) {
    console.error('[HubQuilt:my-feature] Error:', error);
    return; // Fail gracefully
  }
}
```

### Performance

- Use `observeAndProcess` for DOM observation (handles efficiency)
- Cache DOM queries when possible
- Debounce expensive operations
- Avoid blocking the main thread

```typescript
// Good - uses observer
observeAndProcess(['.file-list'], (container) => {
  // Process when element appears
});

// Bad - polling
setInterval(() => {
  const element = document.querySelector('.file-list');
  if (element) { /* process */ }
}, 100);
```

## Feature Guidelines

### Tag Guidelines

Use these tags to categorize your feature:

- **`ui`** - Visual enhancements, styling changes
- **`files`** - File browser, tree view, file-related features
- **`productivity`** - Workflow improvements, time-savers
- **`downloads`** - Download-related functionality
- **`api`** - Uses GitHub API (add this if making API calls)
- **`debug`** - Developer/debugging tools
- **`accessibility`** - Accessibility improvements

**If your feature uses the GitHub API, you MUST:**
1. Add the `"api"` tag
2. Set `requiresPAT: true`
3. Use the `githubApi` client from context, not direct fetch calls

### When to Require PAT

Set `requiresPAT: true` if your feature:
- Makes GitHub API calls that need authentication
- Needs higher rate limits than anonymous (60/hour)
- Accesses private repositories or user-specific data

Features requiring PAT will be automatically disabled in the UI until a token is configured.

### Page Types

Choose appropriate page types for your feature:

- **`repo`** - Main repository page (file list, README)
- **`code`** - Code/tree view pages
- **`issue`** - Individual issue pages
- **`pull`** - Individual pull request pages
- **`pull-list`** - Pull requests list page
- **`issue-list`** - Issues list page
- **`notifications`** - Notifications page
- **`profile`** - User/organization profile pages
- **`unknown`** - Other GitHub pages

### Feature Options

Provide options when users might want different behaviors:

```typescript
options: [
  {
    key: "showIcons",
    label: "Show Icons",
    description: "Display icons next to items",
    type: "boolean",
    defaultValue: true,
  },
  {
    key: "iconSize",
    label: "Icon Size",
    description: "Size of icons in pixels",
    type: "number",
    defaultValue: 16,
    min: 12,
    max: 32,
  },
  {
    key: "theme",
    label: "Theme",
    description: "Color theme for the feature",
    type: "select",
    defaultValue: "auto",
    options: [
      { value: "auto", label: "Auto" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
  },
]
```

## Testing Your Changes

### Manual Testing Checklist

- [ ] Feature works on intended page types
- [ ] Feature doesn't break when disabled and re-enabled
- [ ] Options (if any) update feature behavior immediately
- [ ] Feature doesn't interfere with other features
- [ ] No console errors in browser DevTools
- [ ] Works in both light and dark mode
- [ ] Feature degrades gracefully on errors

### Testing with Different GitHub Pages

Test your feature on various GitHub pages:

1. **Repository pages**: `https://github.com/owner/repo`
2. **File browser**: `https://github.com/owner/repo/tree/main`
3. **Pull requests**: `https://github.com/owner/repo/pull/123`
4. **Issues**: `https://github.com/owner/repo/issues/456`
5. **Profiles**: `https://github.com/username`

### Testing API Features

If your feature uses the GitHub API:

1. Test **without PAT** - feature should be disabled in UI
2. Test **with invalid PAT** - should fail gracefully with error message
3. Test **with valid PAT** - should work normally
4. Test **rate limit scenarios** - should handle 403/429 gracefully

## Submitting a Pull Request

1. **Create a feature branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes**
   - Follow code style guidelines
   - Add your feature to the registry
   - Test thoroughly

3. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add my feature"
   ```

   Use conventional commit messages:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `style:` - Code style changes (formatting)
   - `refactor:` - Code refactoring
   - `test:` - Adding tests
   - `chore:` - Maintenance tasks

4. **Push and create PR**
   ```bash
   git push origin feature/my-feature
   ```

   Then create a pull request on GitHub with:
   - Clear description of what the feature does
   - Screenshots/GIFs demonstrating the feature (if UI change)
   - List of tested scenarios
   - Any known limitations or future improvements

## Common Patterns

### Caching Data

Use chrome.storage.local for persistent caching:

```typescript
const CACHE_KEY = 'my-feature:data';
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

async function getCachedData() {
  const cached = await chrome.storage.local.get(CACHE_KEY);
  const data = cached[CACHE_KEY];

  if (data && Date.now() - data.timestamp < CACHE_DURATION) {
    return data.value;
  }

  return null;
}

async function setCachedData(value: any) {
  await chrome.storage.local.set({
    [CACHE_KEY]: {
      value,
      timestamp: Date.now(),
    }
  });
}
```

### Using the GitHub API Client

Always use the provided `githubApi` from context:

```typescript
async init(ctx, settings) {
  const { githubApi } = ctx;

  // Check if PAT is configured
  const hasPAT = await githubApi.hasToken();
  if (!hasPAT) {
    console.warn('[my-feature] No PAT configured');
    return;
  }

  // Make API calls
  try {
    const data = await githubApi.getJson('/repos/owner/repo/commits');
    // Process data
  } catch (error) {
    console.error('[my-feature] API error:', error);
  }
}
```

### Injecting Styles

Use `injectStyles` for CSS:

```typescript
injectStyles(`
  .my-feature-element {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .my-feature-element:hover {
    background-color: var(--bgColor-muted, #f6f8fa);
  }
`, "my-feature-styles");
```

Use CSS variables for theming compatibility:
- `var(--fgColor-default)` - Default text color
- `var(--bgColor-default)` - Default background
- `var(--borderColor-default)` - Default border color
- `var(--fgColor-muted)` - Muted text color
- See GitHub Primer CSS for more variables

## Getting Help

- **Questions?** Open a GitHub Discussion
- **Found a bug?** Open an issue
- **Need clarification?** Comment on the relevant PR or issue

## Additional Resources

- [Architecture Documentation](./ARCHITECTURE.md)
- [Feature Types Reference](../src/core/feature-types.ts)
- [GitHub Primer CSS](https://primer.style/css/) - GitHub's design system
- [Chrome Extension APIs](https://developer.chrome.com/docs/extensions/reference/)

Thank you for contributing to HubQuilt! 🎉
