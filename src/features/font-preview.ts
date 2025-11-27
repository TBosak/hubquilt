import type { Feature, FeatureContext } from "../core/feature-types";
import type { GithubApiClient } from "../core/github-api-client";
import { observeAndProcess } from "../core/dom-observer";
import { injectStyles } from "../core/dom-utils";

const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2', '.eot'];

let githubApiClient: GithubApiClient | null = null;
let currentFontPreview: HTMLElement | null = null;
let currentBlobUrl: string | null = null;
const processedPages = new WeakSet<Element>();

function parseGitHubUrl(): { owner: string; repo: string; ref: string; path: string } | null {
  const match = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)(?:\/(?:tree|blob)\/([^\/]+)(?:\/(.*))?)?/);

  if (!match) return null;

  const [, owner, repo, ref = 'main', path = ''] = match;
  return { owner, repo, ref, path };
}

function isFontFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return FONT_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
}

async function getFileSha(owner: string, repo: string, ref: string, path: string): Promise<string | null> {
  if (!githubApiClient) {
    console.error('[Font Preview] GitHub API client not initialized');
    return null;
  }

  try {
    // Decode the path (GitHub URLs are encoded but tree paths are not)
    const decodedPath = decodeURIComponent(path);
    console.log('[Font Preview] Looking for file in tree:', { encodedPath: path, decodedPath });

    // Fetch commit to get tree SHA
    const commitData = await githubApiClient.getJson<{ commit: { tree: { sha: string } } }>(
      `/repos/${owner}/${repo}/commits/${ref}`
    );

    const treeSha = commitData.commit.tree.sha;

    // Fetch tree recursively
    const treeData = await githubApiClient.getJson<{ tree: any[] }>(
      `/repos/${owner}/${repo}/git/trees/${treeSha}`,
      { recursive: '1' }
    );

    // Find the file in the tree (use decoded path for comparison)
    const fileEntry = treeData.tree.find((entry: any) => entry.path === decodedPath && entry.type === 'blob');

    if (fileEntry) {
      console.log('[Font Preview] Found file in tree:', { path: fileEntry.path, sha: fileEntry.sha });
      return fileEntry.sha;
    }

    console.warn('[Font Preview] File not found in tree:', decodedPath);
    return null;
  } catch (error) {
    console.error('[Font Preview] Error fetching file SHA:', error);
    return null;
  }
}

async function processBlobView(element: Element) {
  // Always clean up previous preview first (before WeakSet check)
  // This ensures cleanup happens even if DOM element is reused during navigation
  if (currentFontPreview) {
    currentFontPreview.remove();
    currentFontPreview = null;
  }

  // Revoke previous blob URL to prevent memory leaks
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  const urlInfo = parseGitHubUrl();

  // Only show preview on blob (file) pages
  if (!urlInfo || !window.location.pathname.includes('/blob/')) {
    return;
  }

  const { owner, repo, ref, path } = urlInfo;

  // Check if this is a font file
  if (!isFontFile(path)) {
    return;
  }

  // Only process each font file once (prevent duplicate previews)
  const pageKey = `${owner}/${repo}/${ref}/${path}`;
  if (processedPages.has(element) && element.getAttribute('data-font-preview-key') === pageKey) {
    return;
  }
  processedPages.add(element);
  element.setAttribute('data-font-preview-key', pageKey);

  // Check if API client is available
  if (!githubApiClient) {
    console.warn('[Font Preview] GitHub API client not available');
    return;
  }

  console.log('[Font Preview] Detected font file:', path);

  const filename = path.split('/').pop() || 'font';
  const fontName = `HubQuilt-Preview-${Date.now()}`;

  // Show loading state immediately
  const loadingPreview = createLoadingPreview(filename);
  currentFontPreview = loadingPreview;

  const viewRawSection = document.querySelector('[aria-labelledby*="file-name-id"]');
  if (viewRawSection) {
    viewRawSection.insertAdjacentElement('beforebegin', loadingPreview);
  } else {
    element.insertAdjacentElement('afterend', loadingPreview);
  }

  try {
    // Get the file SHA
    const sha = await getFileSha(owner, repo, ref, path);
    if (!sha) {
      throw new Error('Could not find file SHA');
    }

    console.log('[Font Preview] Fetching font blob with SHA:', sha);

    // Fetch the file content using blob API (supports authentication)
    const blobData = await githubApiClient.getJson<{ content: string; encoding: string; size: number }>(
      `/repos/${owner}/${repo}/git/blobs/${sha}`
    );

    // Decode base64 content
    const content = atob(blobData.content);

    // Convert to blob
    const bytes = new Uint8Array(content.length);
    for (let i = 0; i < content.length; i++) {
      bytes[i] = content.charCodeAt(i);
    }

    // Determine MIME type from extension
    const ext = path.toLowerCase().split('.').pop();
    let mimeType = 'font/ttf'; // default
    if (ext === 'woff') mimeType = 'font/woff';
    else if (ext === 'woff2') mimeType = 'font/woff2';
    else if (ext === 'otf') mimeType = 'font/otf';
    else if (ext === 'eot') mimeType = 'application/vnd.ms-fontobject';

    const blob = new Blob([bytes], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    currentBlobUrl = blobUrl;

    console.log('[Font Preview] Font blob created successfully, size:', blob.size);

    // Determine font format for @font-face
    let format = 'truetype'; // default
    if (ext === 'woff') format = 'woff';
    else if (ext === 'woff2') format = 'woff2';
    else if (ext === 'otf') format = 'opentype';
    else if (ext === 'eot') format = 'embedded-opentype';

    // Inject @font-face rule
    injectStyles(`
      @font-face {
        font-family: '${fontName}';
        src: url('${blobUrl}') format('${format}');
        font-style: normal;
        font-weight: normal;
      }
    `, `font-preview-${fontName}`);

    // Create preview element and replace loading state
    const preview = createFontPreview(fontName, filename);
    loadingPreview.replaceWith(preview);
    currentFontPreview = preview;

  } catch (error) {
    console.error('[Font Preview] Error loading font:', error);

    // Show error message (replace loading state)
    const errorPreview = document.createElement('div');
    errorPreview.className = 'hq-font-preview';
    errorPreview.innerHTML = `
      <div class="hq-font-preview-header">
        <strong>Font Preview</strong>
        <span class="hq-font-preview-filename">${filename}</span>
      </div>
      <div class="hq-font-preview-error">
        Unable to load font preview. ${error instanceof Error ? error.message : 'Unknown error'}
      </div>
    `;

    loadingPreview.replaceWith(errorPreview);
    currentFontPreview = errorPreview;
  }
}

function createLoadingPreview(filename: string): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'hq-font-preview';

  preview.innerHTML = `
    <div class="hq-font-preview-header">
      <strong>Font Preview</strong>
      <span class="hq-font-preview-filename">${filename}</span>
    </div>
    <div class="hq-font-preview-loading">
      <div class="hq-font-preview-spinner"></div>
      <span>Loading font preview...</span>
    </div>
  `;

  return preview;
}

function createFontPreview(fontFamily: string, filename: string): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'hq-font-preview';

  preview.innerHTML = `
    <div class="hq-font-preview-header">
      <strong>Font Preview</strong>
      <span class="hq-font-preview-filename">${filename}</span>
    </div>
    <div class="hq-font-preview-content" style="font-family: '${fontFamily}', sans-serif;">
      <div class="hq-font-preview-section">
        <div class="hq-font-preview-label">Uppercase</div>
        <div class="hq-font-preview-text" style="font-size: 24px;">
          ABCDEFGHIJKLMNOPQRSTUVWXYZ
        </div>
      </div>
      <div class="hq-font-preview-section">
        <div class="hq-font-preview-label">Lowercase</div>
        <div class="hq-font-preview-text" style="font-size: 24px;">
          abcdefghijklmnopqrstuvwxyz
        </div>
      </div>
      <div class="hq-font-preview-section">
        <div class="hq-font-preview-label">Numbers</div>
        <div class="hq-font-preview-text" style="font-size: 24px;">
          0123456789
        </div>
      </div>
      <div class="hq-font-preview-section">
        <div class="hq-font-preview-label">Punctuation</div>
        <div class="hq-font-preview-text" style="font-size: 24px;">
          ! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \\ ] ^ _ \` { | } ~
        </div>
      </div>
      <div class="hq-font-preview-section">
        <div class="hq-font-preview-label">Sample</div>
        <div class="hq-font-preview-text" style="font-size: 18px;">
          The quick brown fox jumps over the lazy dog.
        </div>
        <div class="hq-font-preview-text" style="font-size: 14px;">
          Pack my box with five dozen liquor jugs.
        </div>
      </div>
      <div class="hq-font-preview-section">
        <div class="hq-font-preview-label">Sizes</div>
        <div class="hq-font-preview-text" style="font-size: 12px;">
          12px: Almost before we knew it, we had left the ground.
        </div>
        <div class="hq-font-preview-text" style="font-size: 16px;">
          16px: Almost before we knew it, we had left the ground.
        </div>
        <div class="hq-font-preview-text" style="font-size: 24px;">
          24px: Almost before we knew it, we had left the ground.
        </div>
        <div class="hq-font-preview-text" style="font-size: 36px;">
          36px: Almost before we knew it, we had left the ground.
        </div>
      </div>
    </div>
  `;

  return preview;
}

export const fontPreviewFeature: Feature = {
  id: "font-preview",
  name: "Font Preview",
  description: "Shows a live preview when viewing font files (.ttf, .woff, .woff2, .otf)",
  tags: ["ui", "preview", "fonts", "api"],
  pageTypes: ["repo", "code"],
  isEnabledByDefault: true,
  requiresPAT: true,
  async init(ctx: FeatureContext) {
    // Store API client reference
    githubApiClient = ctx.githubApi;

    // Inject base styles
    injectStyles(`
      .hq-font-preview {
        margin: 16px 0;
        border: 1px solid var(--color-border-default);
        border-radius: 6px;
        background: var(--color-canvas-default);
        overflow: hidden;
      }

      .hq-font-preview-header {
        padding: 12px 16px;
        background: var(--color-canvas-subtle);
        border-bottom: 1px solid var(--color-border-default);
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .hq-font-preview-filename {
        font-family: ui-monospace, monospace;
        font-size: 12px;
        color: var(--color-fg-muted);
        background: var(--color-canvas-default);
        padding: 2px 6px;
        border-radius: 3px;
      }

      .hq-font-preview-content {
        padding: 20px;
      }

      .hq-font-preview-section {
        margin-bottom: 24px;
      }

      .hq-font-preview-section:last-child {
        margin-bottom: 0;
      }

      .hq-font-preview-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--color-fg-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
      }

      .hq-font-preview-text {
        margin-bottom: 8px;
        line-height: 1.5;
        color: var(--color-fg-default);
      }

      .hq-font-preview-text:last-child {
        margin-bottom: 0;
      }

      .hq-font-preview-error {
        padding: 20px;
        color: var(--color-fg-muted);
        text-align: center;
        font-size: 14px;
      }

      .hq-font-preview-loading {
        padding: 40px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        color: var(--color-fg-muted);
        font-size: 14px;
      }

      .hq-font-preview-spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--color-border-default);
        border-top-color: var(--color-accent-fg);
        border-radius: 50%;
        animation: hq-font-preview-spin 0.8s linear infinite;
      }

      @keyframes hq-font-preview-spin {
        to { transform: rotate(360deg); }
      }
    `, 'font-preview');

    // Watch for blob view headers (appears when viewing files)
    observeAndProcess(['.react-blob-view-header-sticky'], processBlobView);
  }
};
