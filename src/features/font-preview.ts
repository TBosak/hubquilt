import type { Feature, FeatureContext } from "../core/feature-types";
import type { GithubApiClient } from "../core/github-api-client";
import { observeAndProcess } from "../core/dom-observer";
import { injectStyles } from "../core/dom-utils";
import fontkit from '@pdf-lib/fontkit';

const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2', '.eot'];

let githubApiClient: GithubApiClient | null = null;
let currentFontPreview: HTMLElement | null = null;
let currentFont: any = null; // fontkit.Font type
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

  // Clear previous font reference
  currentFont = null;

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

    // Decode base64 content to binary ArrayBuffer
    const base64Content = blobData.content.replace(/\s+/g, ''); // Remove whitespace
    const binaryString = atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    console.log('[Font Preview] Font data decoded, size:', bytes.length);

    // Parse font using fontkit (supports WOFF2 and completely bypasses CSP restrictions)
    console.log('[Font Preview] Parsing font with fontkit...');
    const font = fontkit.create(bytes.buffer); // Pass ArrayBuffer directly (browsers don't have Buffer)
    currentFont = font;

    console.log('[Font Preview] Font parsed successfully:', {
      familyName: font.familyName,
      fullName: font.fullName,
      postscriptName: font.postscriptName,
      numGlyphs: font.numGlyphs,
      unitsPerEm: font.unitsPerEm
    });

    // Create preview element with canvas rendering and replace loading state
    const preview = createCanvasFontPreview(font, filename);
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

/**
 * Render text to canvas using fontkit (bypasses CSP completely, supports WOFF2)
 */
function renderTextToCanvas(text: string, font: any, fontSize: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  // Get current GitHub theme colors
  const isDark = document.documentElement.getAttribute('data-color-mode') === 'dark';
  const textColor = isDark ? '#e6edf3' : '#1f2328';

  // Layout the text using fontkit
  const glyphRun = font.layout(text);
  const scale = fontSize / font.unitsPerEm;

  // Calculate total width
  let totalWidth = 0;
  for (const position of glyphRun.positions) {
    totalWidth += position.xAdvance * scale;
  }

  const textWidth = Math.ceil(totalWidth);
  const ascender = font.ascent * scale;
  const descender = font.descent * scale;
  const textHeight = Math.ceil(ascender - descender);

  // Set canvas size (with device pixel ratio for sharp rendering)
  const dpr = window.devicePixelRatio || 1;
  const padding = 4;
  canvas.width = (textWidth + padding * 2) * dpr;
  canvas.height = (textHeight + padding * 2) * dpr;
  canvas.style.width = `${textWidth + padding * 2}px`;
  canvas.style.height = `${textHeight + padding * 2}px`;

  // Scale context for device pixel ratio
  ctx.scale(dpr, dpr);
  ctx.fillStyle = textColor;

  // Draw each glyph
  let x = padding;
  const y = ascender + padding;

  for (let i = 0; i < glyphRun.glyphs.length; i++) {
    const glyph = glyphRun.glyphs[i];
    const position = glyphRun.positions[i];

    // Get the glyph path and convert to canvas path
    const path = glyph.path.scale(scale, -scale).translate(x + position.xOffset * scale, y + position.yOffset * scale);

    ctx.beginPath();
    for (const cmd of path.commands) {
      switch (cmd.command) {
        case 'moveTo':
          ctx.moveTo(cmd.args[0], cmd.args[1]);
          break;
        case 'lineTo':
          ctx.lineTo(cmd.args[0], cmd.args[1]);
          break;
        case 'quadraticCurveTo':
          ctx.quadraticCurveTo(cmd.args[0], cmd.args[1], cmd.args[2], cmd.args[3]);
          break;
        case 'bezierCurveTo':
          ctx.bezierCurveTo(cmd.args[0], cmd.args[1], cmd.args[2], cmd.args[3], cmd.args[4], cmd.args[5]);
          break;
        case 'closePath':
          ctx.closePath();
          break;
      }
    }
    ctx.fill();

    x += position.xAdvance * scale;
  }

  return canvas;
}

/**
 * Create font preview using fontkit canvas rendering (bypasses CSP restrictions, supports WOFF2)
 */
function createCanvasFontPreview(font: any, filename: string): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'hq-font-preview';

  // Create header
  const header = document.createElement('div');
  header.className = 'hq-font-preview-header';
  header.innerHTML = `
    <strong>Font Preview</strong>
    <span class="hq-font-preview-filename">${filename}</span>
  `;

  // Create content container
  const content = document.createElement('div');
  content.className = 'hq-font-preview-content';

  // Define preview sections
  const sections = [
    { label: 'Uppercase', text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', fontSize: 24 },
    { label: 'Lowercase', text: 'abcdefghijklmnopqrstuvwxyz', fontSize: 24 },
    { label: 'Numbers', text: '0123456789', fontSize: 24 },
    { label: 'Punctuation', text: '! " # $ % & \' ( ) * + , - . / : ; < = > ? @ [ \\ ] ^ _ ` { | } ~', fontSize: 24 },
    { label: 'Sample', text: 'The quick brown fox jumps over the lazy dog.', fontSize: 18 },
    { label: '', text: 'Pack my box with five dozen liquor jugs.', fontSize: 14 },
    { label: 'Sizes', text: '12px: Almost before we knew it, we had left the ground.', fontSize: 12 },
    { label: '', text: '16px: Almost before we knew it, we had left the ground.', fontSize: 16 },
    { label: '', text: '24px: Almost before we knew it, we had left the ground.', fontSize: 24 },
    { label: '', text: '36px: Almost before we knew it, we had left the ground.', fontSize: 36 },
  ];

  let currentSection: HTMLElement | null = null;

  for (const { label, text, fontSize } of sections) {
    // Create new section if label is present
    if (label) {
      currentSection = document.createElement('div');
      currentSection.className = 'hq-font-preview-section';

      const labelEl = document.createElement('div');
      labelEl.className = 'hq-font-preview-label';
      labelEl.textContent = label;
      currentSection.appendChild(labelEl);

      content.appendChild(currentSection);
    }

    // Render text to canvas using opentype.js
    const canvas = renderTextToCanvas(text, font, fontSize);
    canvas.className = 'hq-font-preview-canvas';

    if (currentSection) {
      currentSection.appendChild(canvas);
    } else {
      content.appendChild(canvas);
    }
  }

  preview.appendChild(header);
  preview.appendChild(content);

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

      .hq-font-preview-canvas {
        display: block;
        margin-bottom: 8px;
      }

      .hq-font-preview-canvas:last-child {
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
