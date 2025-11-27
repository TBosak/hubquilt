import type { Feature } from "../core/feature-types";
import { observeAndProcess } from "../core/dom-observer";
import { injectStyles } from "../core/dom-utils";

interface RepoContext {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

type PackageRegistry = 'npm' | 'crates' | 'pypi' | 'golang';

interface PackageInfo {
  registry: PackageRegistry;
  packageUrl: string;
  githubUrl?: string;
}

type FileType = 'package.json' | 'cargo.toml' | 'requirements.txt' | 'gemfile' | 'composer.json';

// Generic parser configuration
interface ParserConfig {
  pattern: RegExp;
  captureGroup?: number;
  skipComments?: boolean;
  skipEmpty?: boolean;
}

// Generic API fetcher configuration
interface ApiFetcherConfig {
  urlTemplate: (name: string) => string;
  githubPaths: string[]; // JSON paths to try (dot notation)
  cachePrefix: string;
}

interface LanguageConfig {
  fileType: FileType;
  fileMatcher: (path: string) => boolean;
  registryUrl: (packageName: string) => string;
  registryIcon: string;
  registryLabel: string;
  parser: ParserConfig | (() => Set<string> | null); // Can be config or custom function
  githubFetcher: ApiFetcherConfig | ((name: string) => Promise<string | null>) | null;
}

// Cache for package repository URLs
const packageRepoCache = new Map<string, string | null>();

// Generic line-based regex parser
function createGenericParser(config: ParserConfig): () => Set<string> | null {
  return () => {
    try {
      const codeElements = document.querySelectorAll('[data-hpc] [role="row"], .react-file-line, div[id^="LC"]');
      if (!codeElements.length) return null;

      const deps = new Set<string>();

      codeElements.forEach(line => {
        const text = (line.textContent || '').trim();

        if (config.skipEmpty && !text) return;
        if (config.skipComments && text.startsWith('#')) return;

        const match = text.match(config.pattern);
        if (match) {
          const captured = match[config.captureGroup ?? 1];
          if (captured) deps.add(captured);
        }
      });

      return deps.size > 0 ? deps : null;
    } catch (e) {
      return null;
    }
  };
}

// Helper to extract value from nested object using dot notation
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

// Generic API fetcher for GitHub URLs
function createGenericFetcher(config: ApiFetcherConfig): (name: string) => Promise<string | null> {
  return async (name: string) => {
    const cacheKey = `${config.cachePrefix}:${name}`;
    if (packageRepoCache.has(cacheKey)) {
      return packageRepoCache.get(cacheKey)!;
    }

    try {
      const url = config.urlTemplate(name);
      const response = await fetch(url);

      if (!response.ok) {
        packageRepoCache.set(cacheKey, null);
        return null;
      }

      const data = await response.json();
      let githubUrl: string | null = null;

      // Try each configured path
      for (const path of config.githubPaths) {
        const value = getNestedValue(data, path);

        // Handle arrays (like R's URL field)
        if (Array.isArray(value)) {
          for (const item of value) {
            githubUrl = extractGitHubUrl(item);
            if (githubUrl) break;
          }
        } else if (value) {
          githubUrl = extractGitHubUrl(value);
        }

        if (githubUrl) break;
      }

      packageRepoCache.set(cacheKey, githubUrl);
      return githubUrl;
    } catch (e) {
      packageRepoCache.set(cacheKey, null);
      return null;
    }
  };
}

// Consolidated language configuration
const LANGUAGE_CONFIGS: LanguageConfig[] = [
  {
    fileType: 'package.json',
    fileMatcher: (path) => path.endsWith('package.json'),
    registryUrl: (pkg) => `https://www.npmjs.com/package/${pkg}`,
    registryIcon: `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 0v16h16V0H0zm13 13h-2V5H9v8H3V3h10v10z"/></svg>`,
    registryLabel: 'View on npm',
    parser: {
      pattern: /"([^"]+)"\s*:\s*"[^"]+"/,
      skipComments: true,
    },
    githubFetcher: {
      urlTemplate: (pkg) => `https://registry.npmjs.org/${pkg}`,
      githubPaths: ['repository.url', 'repository', 'homepage', 'bugs.url'],
      cachePrefix: 'npm',
    },
  },
  {
    fileType: 'cargo.toml',
    fileMatcher: (path) => path.endsWith('Cargo.toml'),
    registryUrl: (pkg) => `https://crates.io/crates/${pkg}`,
    registryIcon: `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0L1 3v6.5c0 3.5 2.5 6 7 7.5 4.5-1.5 7-4 7-7.5V3L8 0zm0 1.5l5.5 2.25v5.75c0 2.75-2 4.75-5.5 6-3.5-1.25-5.5-3.25-5.5-6V3.75L8 1.5z"/></svg>`,
    registryLabel: 'View on crates.io',
    parser: {
      pattern: /^([a-zA-Z0-9_-]+)\s*=/,
      skipComments: true,
    },
    githubFetcher: {
      urlTemplate: (pkg) => `https://crates.io/api/v1/crates/${pkg}`,
      githubPaths: ['crate.repository', 'crate.homepage'],
      cachePrefix: 'crates',
    },
  },
  {
    fileType: 'requirements.txt',
    fileMatcher: (path) => path.endsWith('requirements.txt'),
    registryUrl: (pkg) => `https://pypi.org/project/${pkg}`,
    registryIcon: `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0C3.6 0 0 3.6 0 8s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm3.5 12L8 9.5 4.5 12l1-4L2 5.5h4L8 1.5l2 4h4L10.5 8l1 4z"/></svg>`,
    registryLabel: 'View on PyPI',
    parser: {
      pattern: /^([a-zA-Z0-9_-]+)/,
      skipComments: true,
      skipEmpty: true,
    },
    githubFetcher: {
      urlTemplate: (pkg) => `https://pypi.org/pypi/${pkg}/json`,
      githubPaths: ['info.project_urls.Source', 'info.project_urls.Homepage', 'info.home_page'],
      cachePrefix: 'pypi',
    },
  },
  {
    fileType: 'gemfile',
    fileMatcher: (path) => path.endsWith('Gemfile') || path.endsWith('Gemfile.lock'),
    registryUrl: (pkg) => `https://rubygems.org/gems/${pkg}`,
    registryIcon: `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1l6 3v2.5L8 10 2 6.5V4l6-3zM2 8.5l6 3 6-3v2L8 14l-6-3.5v-2z"/></svg>`,
    registryLabel: 'View on RubyGems',
    parser: {
      pattern: /gem\s+['"]([a-zA-Z0-9_-]+)['"]/,
      skipComments: true,
    },
    githubFetcher: {
      urlTemplate: (pkg) => `https://rubygems.org/api/v1/gems/${pkg}.json`,
      githubPaths: ['source_code_uri', 'homepage_uri', 'bug_tracker_uri'],
      cachePrefix: 'rubygems',
    },
  },
  {
    fileType: 'composer.json',
    fileMatcher: (path) => path.endsWith('composer.json'),
    registryUrl: (pkg) => `https://packagist.org/packages/${pkg}`,
    registryIcon: `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 2l-6 3v6l6 3 6-3V5l-6-3zm0 1.5l4.5 2.25v4.5L8 12.5l-4.5-2.25v-4.5L8 3.5z"/></svg>`,
    registryLabel: 'View on Packagist',
    parser: {
      pattern: /"([a-z0-9-]+\/[a-z0-9-]+)"\s*:\s*"[^"]+"/,
    },
    githubFetcher: {
      urlTemplate: (pkg) => `https://packagist.org/packages/${pkg}.json`,
      githubPaths: ['package.repository'],
      cachePrefix: 'packagist',
    },
  },
];

// GitHub icon - used for all GitHub links
const GITHUB_ICON = `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path></svg>`;

// External link icon - fallback for other links
const EXTERNAL_LINK_ICON = `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"></path></svg>`;

// Helper functions using the config
function getLanguageConfig(fileType: FileType): LanguageConfig | undefined {
  return LANGUAGE_CONFIGS.find(config => config.fileType === fileType);
}

function getLanguageConfigByPath(path: string): LanguageConfig | undefined {
  return LANGUAGE_CONFIGS.find(config => config.fileMatcher(path));
}

function getRepoContext(): RepoContext | null {
  const pathParts = location.pathname.split('/').filter(Boolean);

  if (pathParts.length < 4 || pathParts[2] !== 'blob') {
    return null;
  }

  const owner = pathParts[0];
  const repo = pathParts[1];
  const branch = pathParts[3];
  const path = pathParts.slice(4).join('/');

  return { owner, repo, branch, path };
}

function extractModuleName(text: string): string {
  // Remove quotes and whitespace
  return text.replace(/["']/g, '').trim();
}

function getIconForLinkType(link: string): string {
  // Check if it's a GitHub link
  if (link.includes('github.com')) {
    return GITHUB_ICON;
  }

  // Check if it matches any registry URL pattern
  for (const config of LANGUAGE_CONFIGS) {
    // Create a test package name to generate a sample URL
    const sampleUrl = config.registryUrl('test-package');
    const registryDomain = new URL(sampleUrl).hostname;

    if (link.includes(registryDomain)) {
      return config.registryIcon;
    }
  }

  // Special case for Node.js docs
  if (link.includes('nodejs.org')) {
    return `<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z"/><path d="M8 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z"/></svg>`;
  }

  // Default external link icon
  return EXTERNAL_LINK_ICON;
}

function getLabelForLinkType(link: string): string {
  // Check if it's a GitHub link
  if (link.includes('github.com')) {
    return 'View on GitHub';
  }

  // Check if it matches any registry URL pattern
  for (const config of LANGUAGE_CONFIGS) {
    const sampleUrl = config.registryUrl('test');
    const registryDomain = new URL(sampleUrl).hostname;

    if (link.includes(registryDomain)) {
      return config.registryLabel;
    }
  }

  // Special case for Node.js docs
  if (link.includes('nodejs.org')) {
    return 'View Node.js docs';
  }

  // Default label
  return 'View module file';
}
function extractGitHubUrl(url: string): string | null {
  const match = url.match(/github\.com[/:]([\w-]+\/[\w.-]+)/);
  if (match) {
    return `https://github.com/${match[1].replace(/\.git$/, '')}`;
  }
  return null;
}

function createLinkButton(link: string, className: string = 'ghml-symbol-link'): HTMLAnchorElement {
  const linkButton = document.createElement('a');
  linkButton.className = `prc-Button-ButtonBase-c50BI Button__StyledButtonComponent-sc-vqy3e4-0 doOvZw prc-Link-Link-85e08 ${className}`;
  linkButton.setAttribute('type', 'button');
  linkButton.href = link;
  linkButton.target = link.startsWith('http') ? '_blank' : '_self';
  linkButton.rel = 'noopener noreferrer';
  linkButton.setAttribute('data-loading', 'false');
  linkButton.setAttribute('data-size', 'small');
  linkButton.setAttribute('data-variant', 'invisible');
  linkButton.style.setProperty('--button-color', 'fg.default');

  const content = document.createElement('span');
  content.setAttribute('data-component', 'buttonContent');
  content.setAttribute('data-align', 'center');
  content.className = 'prc-Button-ButtonContent-HKbr-';

  const iconWrap = document.createElement('span');
  iconWrap.setAttribute('data-component', 'leadingVisual');
  iconWrap.className = 'prc-Button-Visual-2epfX prc-Button-VisualWrap-Db-eB';
  iconWrap.innerHTML = getIconForLinkType(link);

  const label = document.createElement('span');
  label.setAttribute('data-component', 'text');
  label.className = 'prc-Button-Label-pTQ3x';
  label.textContent = getLabelForLinkType(link);

  content.appendChild(iconWrap);
  content.appendChild(label);
  linkButton.appendChild(content);

  return linkButton;
}

let cachedDependencies: Set<string> | null = null;
let lastParsedPath: string | null = null;
let isAddingLinks = false;
let currentProcessingSymbol = '';

function getFileType(path: string): FileType | null {
  const config = getLanguageConfigByPath(path);
  if (config) return config.fileType;

  return null;
}

function parseDependenciesForFile(fileType: FileType): Set<string> | null {
  const config = getLanguageConfig(fileType);
  if (!config) return null;

  // If parser is a function, call it directly
  if (typeof config.parser === 'function') {
    return config.parser();
  }

  // Otherwise, create a parser from the config
  return createGenericParser(config.parser)();
}

function isModuleSymbol(symbolText: string, repoContext: RepoContext | null): boolean {
  if (!repoContext) return false;

  const fileType = getFileType(repoContext.path);
  if (!fileType) return false;

  const moduleName = extractModuleName(symbolText);

  // For dependency files, check against actual parsed dependencies
  if (!cachedDependencies || lastParsedPath !== repoContext.path) {
    cachedDependencies = parseDependenciesForFile(fileType);
    lastParsedPath = repoContext.path;
  }

  return cachedDependencies ? cachedDependencies.has(moduleName) : false;
}

async function addLinkToSymbolPane(symbolPane: Element) {
  // Find the symbol name in the h3
  const symbolH3 = symbolPane.querySelector('h3[aria-label]');
  if (!symbolH3) return;

  const symbolText = symbolH3.getAttribute('aria-label') || symbolH3.textContent || '';
  const moduleName = extractModuleName(symbolText);

  // Prevent concurrent processing of the same symbol
  if (isAddingLinks && currentProcessingSymbol === moduleName) {
    return;
  }

  // If processing a different symbol, wait briefly and retry
  if (isAddingLinks) {
    setTimeout(() => addLinkToSymbolPane(symbolPane), 50);
    return;
  }

  isAddingLinks = true;
  currentProcessingSymbol = moduleName;

  try {
    // Aggressively remove ALL existing links (including duplicates from navigation)
    document.querySelectorAll('.ghml-symbol-link, .ghml-github-link').forEach(el => el.remove());

    // Check if symbol pane has actual content
    const buttonContainer = symbolPane.querySelector('.fNKGDu, [class*="fNKGDu"]');
    if (!buttonContainer) return;

    const repoContext = getRepoContext();

    // Check if this symbol is actually a module/package
    if (!isModuleSymbol(symbolText, repoContext)) {
      return;
    }

    const fileType = repoContext ? getFileType(repoContext.path) : null;
    if (!fileType) return;

    let registryUrl: string | null = null;
    let githubFetcher: ((name: string) => Promise<string | null>) | null = null;

    // Determine registry URL and GitHub fetcher based on file type
    const config = getLanguageConfig(fileType);

    if (config) {
      registryUrl = config.registryUrl(moduleName);

      // Resolve GitHub fetcher - could be config, function, or null
      if (config.githubFetcher) {
        if (typeof config.githubFetcher === 'function') {
          githubFetcher = config.githubFetcher;
        } else {
          githubFetcher = createGenericFetcher(config.githubFetcher);
        }
      }
    }

    if (!registryUrl) return;

    // Add registry link immediately
    const registryButton = createLinkButton(registryUrl, 'ghml-symbol-link');
    buttonContainer.insertBefore(registryButton, buttonContainer.firstChild);

    // Try to get GitHub repo link if we have a fetcher
    if (githubFetcher) {
      const githubUrl = await githubFetcher(moduleName);

      if (githubUrl) {
        // Check if the pane still shows the same symbol (user might have clicked another)
        const currentSymbolH3 = symbolPane.querySelector('h3[aria-label]');
        const currentSymbolText = currentSymbolH3?.getAttribute('aria-label') || '';

        if (extractModuleName(currentSymbolText) === moduleName) {
          // Double-check no duplicate GitHub links exist
          const existingGithubLinks = buttonContainer.querySelectorAll('.ghml-github-link');
          if (existingGithubLinks.length === 0) {
            const githubButton = createLinkButton(githubUrl, 'ghml-github-link');
            // Insert after registry button
            if (registryButton.nextSibling) {
              buttonContainer.insertBefore(githubButton, registryButton.nextSibling);
            } else {
              buttonContainer.insertBefore(githubButton, buttonContainer.firstChild);
            }
          }
        }
      }
    }
  } finally {
    isAddingLinks = false;
    currentProcessingSymbol = '';
  }
}

// Custom panel for files without native symbol support
let customSymbolPanel: HTMLElement | null = null;

function createCustomSymbolPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'ghml-custom-symbols-pane';
  panel.className = 'Panel-module__Box--lC3LD panel-content-narrow-styles inner-panel-content-not-narrow';
  panel.style.cssText = `
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    width: 320px;
    background: var(--bgColor-default, #ffffff);
    border-left: 1px solid var(--borderColor-default, #d0d7de);
    z-index: 100;
    overflow-y: auto;
    padding: 16px;
    box-shadow: -2px 0 8px rgba(0, 0, 0, 0.1);
  `;

  panel.innerHTML = `
    <div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h2 style="font-size: 14px; font-weight: 600; color: var(--fgColor-default); margin: 0;">
          Package Links
        </h2>
        <button
          id="ghml-close-panel"
          type="button"
          class="prc-Button-ButtonBase-c50BI prc-Button-IconButton-szpyj"
          style="border: none; background: transparent; cursor: pointer; padding: 8px;"
          aria-label="Close panel"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"></path>
          </svg>
        </button>
      </div>
      <div id="ghml-panel-package-name" style="margin-bottom: 16px; padding: 12px; background: var(--bgColor-muted, #f6f8fa); border-radius: 6px;">
        <h3 style="font-size: 14px; font-weight: 600; color: var(--fgColor-default); margin: 0; word-break: break-all;"></h3>
      </div>
      <div id="ghml-panel-links" style="display: flex; flex-direction: column; gap: 8px;"></div>
    </div>
  `;

  // Close button handler
  const closeBtn = panel.querySelector('#ghml-close-panel');
  closeBtn?.addEventListener('click', hideCustomSymbolPanel);

  // Keyboard handler (Escape to close)
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      hideCustomSymbolPanel();
      document.removeEventListener('keydown', keyHandler);
    }
  };
  document.addEventListener('keydown', keyHandler);

  // Click outside to close
  setTimeout(() => {
    const clickHandler = (e: MouseEvent) => {
      if (!panel.contains(e.target as Node)) {
        hideCustomSymbolPanel();
        document.removeEventListener('click', clickHandler);
      }
    };
    document.addEventListener('click', clickHandler);
  }, 100);

  return panel;
}

function hideCustomSymbolPanel() {
  if (customSymbolPanel && customSymbolPanel.parentElement) {
    customSymbolPanel.remove();
    customSymbolPanel = null;
  }
}

async function showCustomSymbolPanel(packageName: string, fileType: string) {
  // Remove existing panel
  hideCustomSymbolPanel();

  // Create new panel
  customSymbolPanel = createCustomSymbolPanel();
  document.body.appendChild(customSymbolPanel);

  // Update package name
  const nameEl = customSymbolPanel.querySelector('#ghml-panel-package-name h3');
  if (nameEl) {
    nameEl.textContent = packageName;
  }

  // Determine registry and fetcher
  let registryUrl: string | null = null;
  let githubFetcher: ((name: string) => Promise<string | null>) | null = null;

  const config = getLanguageConfig(fileType as FileType);

  if (config) {
    registryUrl = config.registryUrl(packageName);

    // Resolve GitHub fetcher - could be config, function, or null
    if (config.githubFetcher) {
      if (typeof config.githubFetcher === 'function') {
        githubFetcher = config.githubFetcher;
      } else {
        githubFetcher = createGenericFetcher(config.githubFetcher);
      }
    }
  }

  // Add links
  const linksContainer = customSymbolPanel.querySelector('#ghml-panel-links');
  if (linksContainer && registryUrl) {
    const registryButton = createLinkButton(registryUrl, 'ghml-panel-registry-link');
    registryButton.style.width = '100%';
    registryButton.style.justifyContent = 'flex-start';
    linksContainer.appendChild(registryButton);

    // Try to get GitHub link
    if (githubFetcher) {
      const githubUrl = await githubFetcher(packageName);
      if (githubUrl) {
        const githubButton = createLinkButton(githubUrl, 'ghml-panel-github-link');
        githubButton.style.width = '100%';
        githubButton.style.justifyContent = 'flex-start';
        linksContainer.appendChild(githubButton);
      }
    }
  }
}

function setupClickHandlersForNonSymbolFiles() {
  const repoContext = getRepoContext();
  if (!repoContext) return;

  const fileType = getFileType(repoContext.path);
  if (!fileType || fileType === 'js/ts' || fileType === 'package.json') {
    // Close custom panel if we're on a file that doesn't need it
    hideCustomSymbolPanel();
    return; // These have native symbol support
  }

  // Parse dependencies for this file
  if (!cachedDependencies || lastParsedPath !== repoContext.path) {
    cachedDependencies = parseDependenciesForFile(fileType);
    lastParsedPath = repoContext.path;
  }

  if (!cachedDependencies) return;

  // Add click handlers to package names in the code
  const codeLines = document.querySelectorAll('.react-file-line');
  codeLines.forEach(line => {
    const text = (line.textContent || '').trim();

    // Check if this line contains a dependency
    for (const dep of cachedDependencies!) {
      if (text.includes(dep)) {
        // Find the span containing the package name
        const walker = document.createTreeWalker(
          line,
          NodeFilter.SHOW_TEXT,
          null
        );

        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (parent && node.textContent?.includes(dep)) {
            parent.style.cursor = 'pointer';
            parent.classList.add('ghml-clickable-package');

            parent.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              showCustomSymbolPanel(dep, fileType);
            });
            break;
          }
        }
      }
    }
  });
}

export const moduleLinkerFeature: Feature = {
  id: "module-linker",
  name: "Module Linker",
  description: "Adds links to package registries and GitHub repos in the symbol pane when viewing package.json, Cargo.toml, requirements.txt, Gemfile, and composer.json files.",
  tags: ["code", "navigation", "productivity"],
  pageTypes: ["repo", "code"],
  isEnabledByDefault: true,

  init() {
    // Inject styles for clickable packages and custom panel
    injectStyles(`
      .ghml-clickable-package {
        text-decoration: underline;
        text-decoration-style: dotted;
        text-decoration-color: var(--fgColor-muted, #656d76);
        transition: all 0.2s ease;
      }
      .ghml-clickable-package:hover {
        text-decoration-color: var(--fgColor-accent, #0969da);
        color: var(--fgColor-accent, #0969da);
        background: var(--bgColor-accent-muted, rgba(9, 105, 218, 0.1));
        border-radius: 3px;
      }
      #ghml-custom-symbols-pane {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
      }
      #ghml-custom-symbols-pane button:hover {
        background: var(--bgColor-muted, #f6f8fa);
        border-radius: 6px;
      }
      @media (prefers-color-scheme: dark) {
        #ghml-custom-symbols-pane {
          background: var(--bgColor-default, #0d1117);
          border-left-color: var(--borderColor-default, #30363d);
        }
        #ghml-panel-package-name {
          background: var(--bgColor-muted, #161b22) !important;
        }
      }
    `, 'module-linker-custom-panel');

    // Track observers per element to prevent duplicates
    const observerMap = new WeakMap<Element, MutationObserver>();

    // Setup click handlers for files without symbol pane support
    setTimeout(() => setupClickHandlersForNonSymbolFiles(), 500);

    // Watch for code changes (navigation, etc.)
    observeAndProcess(['.react-code-file-contents'], () => {
      setTimeout(() => setupClickHandlersForNonSymbolFiles(), 200);
    });

    // Watch for GitHub's symbol pane to appear
    observeAndProcess(['#symbols-pane'], (symbolPane) => {
      // Clean up any existing observer for this element
      const existingObserver = observerMap.get(symbolPane);
      if (existingObserver) {
        existingObserver.disconnect();
      }

      // Wait a moment for the pane to be populated
      setTimeout(() => {
        // Initial processing
        addLinkToSymbolPane(symbolPane);

        let isProcessing = false;
        let processingTimer: number | null = null;
        let lastSymbolText = '';

        const processSymbolChange = async () => {
          // Get current symbol
          const symbolH3 = symbolPane.querySelector('h3[aria-label]');
          const currentSymbolText = symbolH3?.getAttribute('aria-label') || '';

          // Only process if symbol actually changed
          if (currentSymbolText === lastSymbolText) {
            return;
          }

          lastSymbolText = currentSymbolText;

          if (isProcessing) return;
          isProcessing = true;

          try {
            await addLinkToSymbolPane(symbolPane);
          } finally {
            isProcessing = false;
          }
        };

        // Watch only the h3 element for aria-label changes
        const symbolH3 = symbolPane.querySelector('h3[aria-label]');
        if (symbolH3) {
          const observer = new MutationObserver(() => {
            // Debounce: only process after 100ms of no changes
            if (processingTimer) {
              clearTimeout(processingTimer);
            }

            processingTimer = window.setTimeout(() => {
              processSymbolChange();
              processingTimer = null;
            }, 100);
          });

          observer.observe(symbolH3, {
            attributes: true,
            attributeFilter: ['aria-label']
          });

          // Store observer for cleanup
          observerMap.set(symbolPane, observer);
        }
      }, 50);
    });
  }
};
