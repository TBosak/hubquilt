# HubQuilt Architecture

This document provides a comprehensive overview of HubQuilt's architecture, key concepts, and internal systems.

## Table of Contents

- [Overview](#overview)
- [Project Structure](#project-structure)
- [Core Concepts](#core-concepts)
- [Feature System](#feature-system)
- [DOM Observation](#dom-observation)
- [GitHub API Integration](#github-api-integration)
- [Caching Strategy](#caching-strategy)
- [Settings & Storage](#settings--storage)
- [Execution Flow](#execution-flow)
- [Security Considerations](#security-considerations)

## Overview

HubQuilt is a modular Chrome extension that enhances GitHub's user interface through a plugin-based feature system. The architecture prioritizes:

- **Modularity**: Features are independent and self-contained
- **Performance**: Efficient DOM observation and caching strategies
- **Extensibility**: Easy to add new features without modifying core code
- **User Control**: All features can be toggled and configured independently
- **Type Safety**: Full TypeScript coverage for better developer experience

## Project Structure

```
hubquilt/
├── src/
│   ├── core/                    # Core systems
│   │   ├── feature-types.ts     # TypeScript interfaces for features
│   │   ├── feature-registry.ts  # Feature registration & initialization
│   │   ├── github-api-client.ts # GitHub API wrapper
│   │   ├── github-page-detect.ts # Page type detection
│   │   ├── dom-observer.ts      # Efficient DOM observation
│   │   └── dom-utils.ts         # DOM manipulation utilities
│   │
│   ├── features/                # Individual features
│   │   ├── file-downloads.ts    # Example: File download feature
│   │   ├── file-icons.ts        # Example: File icons feature
│   │   ├── api-limit.ts         # Example: API rate limit indicator
│   │   └── ...                  # Other features
│   │
│   ├── utils/                   # Shared utilities
│   │   └── gitzip.ts            # ZIP creation utility
│   │
│   ├── ui/                      # User interface
│   │   └── options-ui.ts        # Settings/options page logic
│   │
│   └── entrypoints/             # Extension entry points
│       ├── content/             # Content script entry
│       │   └── index.ts
│       └── options/             # Options page entry
│           └── index.html
│
├── public/                      # Static assets
├── docs/                        # Documentation
└── .output/                     # Build output
```

## Core Concepts

### 1. Feature System

Features are the building blocks of HubQuilt. Each feature is a self-contained module that:

- Declares metadata (name, description, tags, page types)
- Implements an `init()` function that runs when enabled
- Can have configurable options
- Can be enabled/disabled independently

**Feature Lifecycle:**

```
Extension Load → Page Detection → Feature Filtering → PAT Check → Feature Init
```

1. **Extension loads** on a GitHub page
2. **Page type is detected** (repo, issue, pull, etc.)
3. **Features are filtered** by page type
4. **PAT requirements checked** (skip if needed but not available)
5. **Feature init()** called with context

### 2. Feature Context

Every feature receives a context object containing:

```typescript
interface FeatureContext {
  document: Document;           // Page's document object
  location: Location;           // Current URL location
  pageType: PageType;           // Detected page type
  repo: RepoInfo | null;        // Repository info (if on a repo page)
  rootElement: Document;        // Root element for DOM queries
  storage: StorageAPI;          // Persistent storage API
  githubApi: GithubApiClient;   // GitHub API client
}
```

This context provides everything a feature needs to:
- Manipulate the DOM
- Make API calls
- Store persistent data
- Adapt behavior based on page type

### 3. Page Type Detection

HubQuilt detects the current GitHub page type to run appropriate features:

```typescript
type PageType =
  | "repo"         // Main repository page
  | "code"         // File/tree browser
  | "issue"        // Individual issue
  | "pull"         // Individual pull request
  | "pull-list"    // PR list page
  | "issue-list"   // Issues list page
  | "notifications"// Notifications page
  | "profile"      // User/org profile
  | "unknown";     // Other pages
```

**Detection Logic** (`src/core/github-page-detect.ts`):

1. Parse URL pathname
2. Check for distinctive DOM elements
3. Return matched page type

Example:
- URL `/owner/repo` + file list → `repo`
- URL `/owner/repo/tree/main` → `code`
- URL `/owner/repo/pull/123` → `pull`

## Feature System

### Feature Definition

```typescript
interface Feature {
  // Metadata
  id: string;                    // Unique identifier
  name: string;                  // Display name
  description: string;           // User-facing description
  tags?: string[];               // Categorization tags
  pageTypes: PageType[];         // Where feature runs
  isEnabledByDefault: boolean;   // Default enabled state
  requiresPAT?: boolean;         // Requires GitHub token?

  // Configuration
  options?: FeatureOption[];     // User-configurable options

  // Implementation
  init(ctx: FeatureContext, settings?: Record<string, any>): Promise<void> | void;
}
```

### Feature Registration

Features register themselves in `feature-registry.ts`:

```typescript
const ALL_FEATURES: Feature[] = [
  apiLimit,
  fileIconsFeature,
  fileDownloadsFeature,
  // ... add new features here
];
```

The registry:
1. Exports `listAllFeatures()` for UI
2. Exports `bootstrapFeatures()` to initialize on page load
3. Manages feature settings (enabled/disabled state)
4. Manages feature options (configuration values)

### Feature Initialization Flow

```typescript
async function bootstrapFeatures(document: Document, location: Location) {
  // 1. Detect page type
  const pageType = detectPageType(document, location);

  // 2. Load user settings
  const featureSettings = await getFeatureSettings();
  const featureOptions = await getFeatureOptions();

  // 3. Create GitHub API client
  const githubApi = createGithubApiClient();
  const hasPAT = await githubApi.hasToken();

  // 4. Create context
  const ctx: FeatureContext = { /* ... */ };

  // 5. Initialize each enabled feature
  for (const feature of ALL_FEATURES) {
    // Skip if wrong page type
    if (!feature.pageTypes.includes(pageType)) continue;

    // Skip if disabled
    const enabled = featureSettings[feature.id] ?? feature.isEnabledByDefault;
    if (!enabled) continue;

    // Skip if requires PAT but none configured
    if (feature.requiresPAT && !hasPAT) continue;

    // Initialize feature
    await feature.init(ctx, settings);
  }
}
```

## DOM Observation

HubQuilt uses an efficient DOM observation system to handle GitHub's dynamic page updates (SPA navigation, lazy loading, etc.).

### Why DOM Observation?

GitHub is a single-page application that:
- Doesn't reload pages on navigation
- Lazy-loads content as you scroll
- Dynamically updates the DOM

Features need to react to these changes without polling.

### ObserveAndProcess Pattern

**API** (`src/core/dom-observer.ts`):

```typescript
function observeAndProcess(
  selectors: string[],           // CSS selectors to watch
  callback: (element: Element) => void,  // Process function
  options?: ObserverOptions
): void
```

**How it works:**

1. **Initial scan**: Queries for existing matching elements
2. **Setup observer**: Watches for new matching elements
3. **Callback invocation**: Calls callback for each match
4. **Deduplication**: Ensures elements are only processed once

**Example:**

```typescript
observeAndProcess(
  ['tr.react-directory-row'],    // Watch for file rows
  (row) => {
    // Add download button to each row
    const button = createDownloadButton();
    row.appendChild(button);
  }
);
```

### Processing Elements

**Best Practice**: Use `WeakSet` to track processed elements:

```typescript
const processedElements = new WeakSet<Element>();

function processElement(element: Element) {
  // Skip if already processed
  if (processedElements.has(element)) return;

  // Process element
  // ...

  // Mark as processed
  processedElements.add(element);
}
```

**Why WeakSet?**
- Automatically garbage collected when element is removed
- No memory leaks from stale references
- Fast lookup (O(1))

## GitHub API Integration

### API Client

HubQuilt provides a centralized GitHub API client (`src/core/github-api-client.ts`).

**Features:**
- Automatic authentication with PAT (if configured)
- Rate limit checking
- Typed responses
- Error handling

**API:**

```typescript
interface GithubApiClient {
  hasToken(): Promise<boolean>;
  getRateLimit(): Promise<{ remaining: number; reset: number } | null>;
  getJson<T>(path: string, params?: Record<string, any>): Promise<T>;
}
```

**Usage:**

```typescript
async init(ctx) {
  const { githubApi } = ctx;

  // Check if authenticated
  if (!(await githubApi.hasToken())) {
    console.warn('Feature requires PAT');
    return;
  }

  // Make API call
  const commits = await githubApi.getJson<Commit[]>(
    '/repos/owner/repo/commits',
    { per_page: 10 }
  );
}
```

### Rate Limiting

GitHub API has rate limits:
- **Unauthenticated**: 60 requests/hour
- **Authenticated (PAT)**: 5,000 requests/hour

**Handling rate limits:**

1. **Require PAT**: Set `requiresPAT: true` for API-heavy features
2. **Cache aggressively**: Cache API responses
3. **Graceful degradation**: Feature should work with cached data when rate-limited
4. **Request queuing**: Throttle concurrent requests

## Caching Strategy

### Multi-Level Caching

HubQuilt implements a sophisticated caching strategy to minimize API calls:

#### Level 1: In-Memory Cache
- **Purpose**: Fast access during single page session
- **Duration**: Until page navigation
- **Implementation**: JavaScript `Map` objects

```typescript
const inFlightRequests = new Map<string, Promise<any>>();
```

#### Level 2: Local Storage Cache
- **Purpose**: Persist across page loads
- **Duration**: Configurable (default 1 hour)
- **Implementation**: `chrome.storage.local`

```typescript
await chrome.storage.local.set({
  'cache-key': {
    data: value,
    timestamp: Date.now()
  }
});
```

#### Level 3: Commit-Based Invalidation
- **Purpose**: Only re-fetch when content actually changes
- **Implementation**: Store last commit time with cached data

```typescript
interface CachedData {
  data: any;
  timestamp: number;
  lastCommitTime?: string;  // From GitHub's <relative-time> element
}
```

**Invalidation logic:**
```typescript
// Only invalidate if file was modified after cache
if (lastCommitTime && cachedData.lastCommitTime) {
  if (new Date(lastCommitTime) > new Date(cachedData.lastCommitTime)) {
    // Invalidate cache, fetch fresh data
  }
}
```

### Cache Key Strategy

Use hierarchical keys for efficient invalidation:

```
hq-file-cache:tree:{owner}/{repo}/{ref}
hq-file-cache:file:{owner}/{repo}/{ref}:{path}
hq-file-cache:folder:{owner}/{repo}/{ref}:{path}
```

## Settings & Storage

### Storage Structure

HubQuilt uses `chrome.storage.sync` for settings (syncs across devices) and `chrome.storage.local` for cache (local only).

**Sync Storage** (`chrome.storage.sync`):
```typescript
{
  "featureSettings": {
    "file-downloads": true,
    "file-icons": true,
    "api-limit": false
  },
  "featureOptions": {
    "file-downloads": {
      "showFileSize": true,
      "showDownloadButton": true
    }
  },
  "githubPat": "ghp_xxxxx",  // Stored in local, not sync!
  "themePreference": "dark"
}
```

**Local Storage** (`chrome.storage.local`):
```typescript
{
  "githubPat": "ghp_xxxxx",  // PAT stored locally for security
  "hq-file-cache:tree:owner/repo/main": { /* cached tree data */ },
  "hq-file-cache:file:owner/repo/main:README.md": { /* cached file */ }
}
```

### Settings API

Features access storage through the context:

```typescript
// Get stored value with fallback
const value = await ctx.storage.get('myKey', defaultValue);

// Set stored value
await ctx.storage.set('myKey', newValue);
```

Storage is namespaced per-feature automatically.

## Execution Flow

### 1. Extension Installation/Update

```
Install → Load manifest → Inject content script into GitHub tabs
```

### 2. Page Load

```
GitHub page loads
    ↓
Content script executes (src/entrypoints/content/index.ts)
    ↓
detectPageType(document, location)
    ↓
bootstrapFeatures(document, location)
    ↓
For each feature:
    ↓
Check page type match → Check enabled → Check PAT (if required) → init()
```

### 3. Feature Initialization

```
feature.init(ctx, settings)
    ↓
Query DOM for initial elements
    ↓
Set up DOM observer for dynamic content
    ↓
Inject styles (if needed)
    ↓
Add event listeners
    ↓
Make API calls (if needed)
    ↓
Render UI enhancements
```

### 4. User Interaction

**Settings Change:**
```
User opens options page
    ↓
Toggle feature on/off → Update chrome.storage.sync
    ↓
Change option value → Update chrome.storage.sync
    ↓
(Features read settings on next page load)
```

**PAT Configuration:**
```
User enters PAT → Save to chrome.storage.local
    ↓
Options UI re-renders (enables PAT-required features)
    ↓
(Features with requiresPAT now initialize on next page load)
```

## Security Considerations

### Personal Access Token (PAT) Storage

- **Location**: `chrome.storage.local` (NOT synced)
- **Transmission**: Only sent to `api.github.com` via HTTPS
- **Access**: Only accessible by extension code
- **User Control**: Can be cleared from options page

**Why local storage?**
- Tokens should not sync across devices (security best practice)
- Each installation should have its own token
- Easier to revoke/rotate tokens per-device

### Content Security Policy (CSP)

GitHub's CSP is strict. HubQuilt:
- Uses inline styles via `style` elements (allowed)
- Avoids `eval()` and inline event handlers
- Loads all resources from extension package

### Permissions

**Minimal permissions:**
- `storage`: For settings and cache
- `host_permissions`: Only `github.com` and `gist.github.com`

No broad permissions like `tabs`, `webRequest`, or `<all_urls>`.

### API Security

- Never expose PAT in logs or error messages
- Validate API responses before processing
- Handle rate limit errors gracefully
- Sanitize user input before DOM insertion

## Performance Optimizations

### 1. Efficient DOM Observation

- Single MutationObserver per feature (not per element)
- Debounced callbacks for rapid changes
- Disconnect observers when features are disabled

### 2. Request Batching

For API-heavy features:
- Batch multiple requests into single call when possible
- Use GitHub's tree API (recursive) instead of individual file requests
- Share request promises (avoid duplicate concurrent requests)

### 3. Lazy Loading

- Features only initialize on matching page types
- Options UI only loads when opened
- Heavy resources loaded on-demand

### 4. WeakSet/WeakMap Usage

- Automatic garbage collection
- No manual cleanup needed
- Prevents memory leaks

### 5. CSS Injection

- Single `<style>` tag per feature
- Scoped styles with unique class prefixes
- Use CSS variables for theming

## Extension Points

Want to extend HubQuilt's core functionality?

### Custom DOM Observer

Create specialized observers for specific use cases:

```typescript
// src/core/specialized-observer.ts
export function observeRepoNavigation(callback: () => void) {
  // Detect SPA navigation on GitHub
}
```

### Additional API Methods

Extend the GitHub API client:

```typescript
// src/core/github-api-client.ts
export interface GithubApiClient {
  // Add methods for common API patterns
  getTree(owner: string, repo: string, sha: string): Promise<TreeResponse>;
  getCommits(owner: string, repo: string, options?: CommitOptions): Promise<Commit[]>;
}
```

### Shared Utilities

Create reusable utilities in `src/utils/`:

```typescript
// src/utils/formatters.ts
export function formatFileSize(bytes: number): string { /* ... */ }
export function formatDate(date: Date): string { /* ... */ }

// src/utils/request-queue.ts
export class RequestQueue { /* ... */ }
```

## Further Reading

- [Contributing Guide](./CONTRIBUTING.md)
- [Feature Types Reference](../src/core/feature-types.ts)
- [WXT Framework Documentation](https://wxt.dev/)
- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [GitHub API Documentation](https://docs.github.com/en/rest)

---

**Questions?** Open a GitHub Discussion or check existing documentation.
