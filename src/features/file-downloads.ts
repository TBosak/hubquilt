import type { Feature, FeatureContext } from "../core/feature-types";
import { observeAndProcess } from "../core/dom-observer";
import { injectStyles } from "../core/dom-utils";
import { downloadFolderAsZip, calculateFolderSize } from "../utils/gitzip";
import type { GithubApiClient } from "../core/github-api-client";

const processedElements = new WeakSet<Element>();

// Store GitHub API client reference
let githubApiClient: GithubApiClient | null = null;

interface FileMetadata {
  size: number;
  downloadUrl: string;
  sha?: string;
}

interface CachedTreeData {
  tree: any[];
  timestamp: number;
  lastCommitTime?: string;
}

interface CachedFileMetadata {
  size: number;
  downloadUrl: string;
  sha?: string;
  timestamp: number;
  lastCommitTime?: string;
}

interface CachedFolderMetadata {
  size: number;
  timestamp: number;
  lastCommitTime?: string;
}

interface QueuedRequest {
  fn: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Cache configuration
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour
const CACHE_PREFIX = 'hq-file-cache:';

// Request queue for rate limiting
const requestQueue: QueuedRequest[] = [];
let isProcessingQueue = false;
const REQUEST_DELAY = 300; // 300ms between requests

// In-flight tree fetch promises to avoid duplicate requests
const inFlightTreeFetches = new Map<string, Promise<any[] | null>>();

// Rate limit error tracking
let isRateLimited = false;
let rateLimitResetTime: number | null = null;
const RATE_LIMIT_RESET_DURATION = 60 * 60 * 1000; // 1 hour

// Check if rate limit has expired
function checkRateLimitExpired(): boolean {
  if (!isRateLimited || !rateLimitResetTime) {
    return false;
  }

  if (Date.now() >= rateLimitResetTime) {
    isRateLimited = false;
    rateLimitResetTime = null;
    return true;
  }

  return false;
}

// Set rate limited state
function setRateLimited(): void {
  if (!isRateLimited) {
    isRateLimited = true;
    rateLimitResetTime = Date.now() + RATE_LIMIT_RESET_DURATION;
    console.warn('[File Downloads] GitHub API rate limit reached. File downloads disabled for 1 hour.');
  }
}

// Process request queue with delay
async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;

  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    if (request) {
      try {
        const result = await request.fn();
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }

      // Wait before processing next request
      if (requestQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
      }
    }
  }

  isProcessingQueue = false;
}

// Queue an API request
function queueRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    requestQueue.push({ fn, resolve, reject });
    processQueue();
  });
}

// Persistent cache helpers
async function getCachedTree(owner: string, repo: string, ref: string): Promise<any[] | null> {
  const cacheKey = `${CACHE_PREFIX}tree:${owner}/${repo}/${ref}`;
  const cached = await chrome.storage.local.get(cacheKey);
  const data = cached[cacheKey] as CachedTreeData | undefined;

  if (data && Date.now() - data.timestamp < CACHE_DURATION) {
    return data.tree;
  }

  return null;
}

async function setCachedTree(owner: string, repo: string, ref: string, tree: any[]): Promise<void> {
  const cacheKey = `${CACHE_PREFIX}tree:${owner}/${repo}/${ref}`;
  const data: CachedTreeData = {
    tree,
    timestamp: Date.now()
  };
  await chrome.storage.local.set({ [cacheKey]: data });
}

async function getCachedFileMetadata(owner: string, repo: string, path: string, ref: string, lastCommitTime?: string): Promise<FileMetadata | null> {
  const cacheKey = `${CACHE_PREFIX}file:${owner}/${repo}/${ref}:${path}`;
  const cached = await chrome.storage.local.get(cacheKey);
  const data = cached[cacheKey] as CachedFileMetadata | undefined;

  if (!data) {
    return null;
  }

  // Invalidate cache if it doesn't have a SHA (old cache format)
  if (!data.sha) {
    console.log('[File Metadata] Cache entry missing SHA, invalidating:', path);
    return null;
  }

  // If we have lastCommitTime from DOM, check if cache is still valid
  if (lastCommitTime && data.lastCommitTime) {
    // Cache is invalid if file was committed after our cached version
    if (new Date(lastCommitTime) > new Date(data.lastCommitTime)) {
      return null;
    }
  } else {
    // Fall back to time-based expiration if no commit time available
    if (Date.now() - data.timestamp >= CACHE_DURATION) {
      return null;
    }
  }

  return {
    size: data.size,
    downloadUrl: data.downloadUrl,
    sha: data.sha
  };
}

async function setCachedFileMetadata(owner: string, repo: string, path: string, ref: string, metadata: FileMetadata, lastCommitTime?: string): Promise<void> {
  const cacheKey = `${CACHE_PREFIX}file:${owner}/${repo}/${ref}:${path}`;
  const data: CachedFileMetadata = {
    ...metadata,
    timestamp: Date.now(),
    lastCommitTime
  };
  await chrome.storage.local.set({ [cacheKey]: data });
}

async function getCachedFolderSize(owner: string, repo: string, path: string, ref: string, lastCommitTime?: string): Promise<number | null> {
  const cacheKey = `${CACHE_PREFIX}folder:${owner}/${repo}/${ref}:${path}`;
  const cached = await chrome.storage.local.get(cacheKey);
  const data = cached[cacheKey] as CachedFolderMetadata | undefined;

  if (!data) {
    return null;
  }

  // If we have lastCommitTime from DOM, check if cache is still valid
  if (lastCommitTime && data.lastCommitTime) {
    // Cache is invalid if folder was committed after our cached version
    if (new Date(lastCommitTime) > new Date(data.lastCommitTime)) {
      return null;
    }
  } else {
    // Fall back to time-based expiration if no commit time available
    if (Date.now() - data.timestamp >= CACHE_DURATION) {
      return null;
    }
  }

  return data.size;
}

async function setCachedFolderSize(owner: string, repo: string, path: string, ref: string, size: number, lastCommitTime?: string): Promise<void> {
  const cacheKey = `${CACHE_PREFIX}folder:${owner}/${repo}/${ref}:${path}`;
  const data: CachedFolderMetadata = {
    size,
    timestamp: Date.now(),
    lastCommitTime
  };
  await chrome.storage.local.set({ [cacheKey]: data });
}

// Fetch tree data with caching
async function fetchTreeData(owner: string, repo: string, ref: string): Promise<any[] | null> {
  // Check if rate limit has expired
  checkRateLimitExpired();

  // If we're rate limited, don't even try
  if (isRateLimited) {
    return null;
  }

  const cacheKey = `${owner}/${repo}/${ref}`;

  // Check cache first
  const cached = await getCachedTree(owner, repo, ref);
  if (cached) {
    return cached;
  }

  // Check if we're already fetching this tree
  const inFlight = inFlightTreeFetches.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  // Create new fetch promise and store it
  const fetchPromise = queueRequest(async () => {
    try {
      if (!githubApiClient) {
        console.error('[File Downloads] GitHub API client not initialized');
        return null;
      }

      console.log('[Tree Fetch] Fetching tree for:', { owner, repo, ref });

      // Fetch commit to get tree SHA
      const commitData = await githubApiClient.getJson<{ commit: { tree: { sha: string } } }>(
        `/repos/${owner}/${repo}/commits/${ref}`
      );

      const treeSha = commitData.commit.tree.sha;
      console.log('[Tree Fetch] Got tree SHA:', treeSha);

      // Fetch tree recursively
      const treeData = await githubApiClient.getJson<{ tree: any[] }>(
        `/repos/${owner}/${repo}/git/trees/${treeSha}`,
        { recursive: '1' }
      );

      const tree = treeData.tree;
      console.log('[Tree Fetch] Tree fetched successfully:', {
        itemCount: tree.length,
        sampleItems: tree.slice(0, 3).map((item: any) => ({ path: item.path, type: item.type, sha: item.sha }))
      });

      // Cache the tree data
      await setCachedTree(owner, repo, ref, tree);

      return tree;
    } catch (error: any) {
      // Check for rate limit or forbidden errors
      if (error.message && (error.message.includes('403') || error.message.includes('429'))) {
        setRateLimited();
      }
      console.error('[File Downloads] Error fetching tree:', error);
      return null;
    } finally {
      // Remove from in-flight map when done
      inFlightTreeFetches.delete(cacheKey);
    }
  });

  inFlightTreeFetches.set(cacheKey, fetchPromise);
  return fetchPromise;
}

/**
 * Extract last commit time from DOM element (relative-time tag)
 */
function getLastCommitTime(element: Element): string | null {
  // Look for relative-time element in the row
  const relativeTime = element.querySelector('relative-time');
  if (relativeTime) {
    return relativeTime.getAttribute('datetime');
  }
  return null;
}

async function getFileMetadata(owner: string, repo: string, path: string, ref: string, lastCommitTime?: string): Promise<FileMetadata | null> {
  console.log('[File Metadata] Fetching metadata for:', { owner, repo, path, ref });

  // Check cache first with commit time validation
  const cached = await getCachedFileMetadata(owner, repo, path, ref, lastCommitTime);
  if (cached) {
    console.log('[File Metadata] Using cached metadata:', { path, sha: cached.sha });
    return cached;
  }

  // Try to get from tree data (avoids individual API calls)
  const tree = await fetchTreeData(owner, repo, ref);
  console.log('[File Metadata] Tree fetched:', { hasTree: !!tree, treeLength: tree?.length });

  if (tree) {
    // Decode path for comparison (GitHub URLs are encoded but tree paths are not)
    const decodedPath = decodeURIComponent(path);
    const fileEntry = tree.find((entry: any) => entry.path === decodedPath && entry.type === 'blob');
    console.log('[File Metadata] File entry found:', {
      path: decodedPath,
      found: !!fileEntry,
      sha: fileEntry?.sha,
      size: fileEntry?.size
    });

    if (fileEntry) {
      const downloadUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
      const metadata: FileMetadata = {
        size: fileEntry.size || 0,
        downloadUrl,
        sha: fileEntry.sha
      };

      console.log('[File Metadata] Created metadata:', metadata);

      // Cache it with commit time
      await setCachedFileMetadata(owner, repo, path, ref, metadata, lastCommitTime);

      return metadata;
    }
  }

  console.warn('[File Metadata] No metadata found for:', path);
  return null;
}

function parseGitHubUrl(): { owner: string; repo: string; ref: string; path: string } | null {
  const match = window.location.pathname.match(/^\/([^\/]+)\/([^\/]+)(?:\/(?:tree|blob)\/([^\/]+)(?:\/(.*))?)?/);

  if (!match) return null;

  const [, owner, repo, ref = 'main', path = ''] = match;
  return { owner, repo, ref, path };
}

async function addDownloadInfo(element: Element, settings?: Record<string, any>) {
  // Check if rate limit has expired
  checkRateLimitExpired();

  if (processedElements.has(element)) {
    return;
  }

  // Check if element already has our download info (prevents duplicates)
  if (element.querySelector('.hq-file-info-cell') || element.querySelector('.hq-file-info')) {
    processedElements.add(element);
    return;
  }

  // Mark as processed early to prevent race conditions
  processedElements.add(element);

  let filename = '';
  let itemPath = '';
  let ref = '';
  let actionsCell: Element | null = null;
  let isDirectory = false;

  // GitHub react-directory-row (main UI)
  if (element.matches('tr.react-directory-row')) {
    const filenameLink = element.querySelector('.react-directory-filename-column a[title]');
    if (filenameLink) {
      filename = filenameLink.getAttribute('title') || '';
      const href = filenameLink.getAttribute('href') || '';

      // Check if it's a directory (tree) or file (blob)
      const blobMatch = href.match(/\/blob\/([^\/]+)\/(.+)$/);
      const treeMatch = href.match(/\/tree\/([^\/]+)\/(.+)$/);

      if (blobMatch) {
        ref = blobMatch[1];
        itemPath = blobMatch[2];
        isDirectory = false;
      } else if (treeMatch) {
        ref = treeMatch[1];
        itemPath = treeMatch[2];
        isDirectory = true;
      }

      // Find the actions cell (last td in the row)
      const cells = element.querySelectorAll('td');
      actionsCell = cells[cells.length - 1];
    }
  }

  // GitHub file tree
  if (!filename && element.matches('.PRIVATE_TreeView-item')) {
    const treeItemContent = element.querySelector('.PRIVATE_TreeView-item-content-text > span');
    const blobLink = element.querySelector('a[href*="/blob/"]');
    const treeLink = element.querySelector('a[href*="/tree/"]');

    if (treeItemContent && (blobLink || treeLink)) {
      filename = treeItemContent.textContent?.trim() || '';
      const link = blobLink || treeLink;
      const href = link?.getAttribute('href') || '';

      if (blobLink) {
        const pathMatch = href.match(/\/blob\/([^\/]+)\/(.+)$/);
        if (pathMatch) {
          ref = pathMatch[1];
          itemPath = pathMatch[2];
          isDirectory = false;
        }
      } else if (treeLink) {
        const pathMatch = href.match(/\/tree\/([^\/]+)\/(.+)$/);
        if (pathMatch) {
          ref = pathMatch[1];
          itemPath = pathMatch[2];
          isDirectory = true;
        }
      }

      actionsCell = element;
    }
  }

  // Skip if we couldn't extract the necessary info
  if (!filename || !itemPath || !ref) {
    return;
  }

  // Get owner and repo from URL
  const urlInfo = parseGitHubUrl();
  if (!urlInfo) return;

  if (!actionsCell) {
    return;
  }

  // Extract last commit time from DOM for cache validation
  const lastCommitTime = getLastCommitTime(element);

  // Check if we should skip due to rate limiting
  if (isRateLimited) {
    // Check if we have cached data before giving up
    if (isDirectory) {
      const cachedSize = await getCachedFolderSize(urlInfo.owner, urlInfo.repo, itemPath, ref, lastCommitTime);
      if (!cachedSize) {
        return; // Skip if rate limited and no cache
      }
    } else {
      const cached = await getCachedFileMetadata(urlInfo.owner, urlInfo.repo, itemPath, ref, lastCommitTime);
      if (!cached) {
        return; // Skip this file if rate limited and no cache
      }
    }
  }

  // Fetch metadata first (will use cache if available)
  let size = 0;
  let downloadUrl = '';
  let fileSha = '';

  try {
    if (isDirectory) {
      // For folders, check cache first
      const cachedSize = await getCachedFolderSize(urlInfo.owner, urlInfo.repo, itemPath, ref, lastCommitTime);
      if (cachedSize !== null) {
        size = cachedSize;
      } else if (settings?.showFileSize !== false && githubApiClient) {
        // Calculate and cache folder size
        size = await calculateFolderSize(urlInfo.owner, urlInfo.repo, ref, itemPath, githubApiClient);
        if (size > 0) {
          await setCachedFolderSize(urlInfo.owner, urlInfo.repo, itemPath, ref, size, lastCommitTime);
        }
      }
    } else {
      // For files, get metadata with commit time validation
      const metadata = await getFileMetadata(urlInfo.owner, urlInfo.repo, itemPath, ref, lastCommitTime);

      if (!metadata) {
        return; // Skip if we couldn't get metadata
      }

      size = metadata.size;
      downloadUrl = metadata.downloadUrl;
      fileSha = metadata.sha || '';
    }
  } catch (error) {
    console.error('[File Downloads] Error fetching metadata:', error);
    return;
  }

  // Create file info container (only after we have the data)
  const infoContainer = document.createElement('div');
  infoContainer.className = 'hq-file-info';

  // File/Folder size
  if (settings?.showFileSize !== false && size > 0) {
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'hq-file-size';
    sizeSpan.textContent = formatFileSize(size);
    sizeSpan.title = `${size.toLocaleString()} bytes${isDirectory ? ' (total)' : ''}`;
    infoContainer.appendChild(sizeSpan);
  }

  // Download button
  if (settings?.showDownloadButton !== false) {
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'hq-download-btn';
    downloadBtn.title = isDirectory ? `Download ${filename} as ZIP` : `Download ${filename}`;

    // Store metadata as data attributes for access in click handler
    downloadBtn.setAttribute('data-is-directory', String(isDirectory));
    downloadBtn.setAttribute('data-filename', filename);
    downloadBtn.setAttribute('data-path', itemPath);
    downloadBtn.setAttribute('data-ref', ref);
    if (fileSha) {
      downloadBtn.setAttribute('data-file-sha', fileSha);
    }

    downloadBtn.innerHTML = `
      <svg class="octicon" viewBox="0 0 16 16" width="16" height="16">
        <path d="M7.47 10.78a.75.75 0 0 0 1.06 0l3.75-3.75a.75.75 0 0 0-1.06-1.06L8.75 8.44V1.75a.75.75 0 0 0-1.5 0v6.69L4.78 5.97a.75.75 0 0 0-1.06 1.06l3.75 3.75ZM3.75 13a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Z"></path>
      </svg>
    `;

    downloadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();

      // Read metadata from data attributes
      const btnIsDirectory = downloadBtn.getAttribute('data-is-directory') === 'true';
      const btnFilename = downloadBtn.getAttribute('data-filename') || filename;
      const btnPath = downloadBtn.getAttribute('data-path') || itemPath;
      const btnRef = downloadBtn.getAttribute('data-ref') || ref;
      const btnFileSha = downloadBtn.getAttribute('data-file-sha') || '';

      console.log('[File Download] Download clicked:', {
        isDirectory: btnIsDirectory,
        filename: btnFilename,
        sha: btnFileSha,
        hasGithubApi: !!githubApiClient
      });

      if (btnIsDirectory) {
        // Download folder as ZIP
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = `
          <svg class="octicon" viewBox="0 0 16 16" width="16" height="16">
            <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" opacity="0.3">
              <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="1s" repeatCount="indefinite"/>
            </path>
          </svg>
        `;

        try {
          if (!githubApiClient) {
            throw new Error('GitHub API client not available');
          }

          await downloadFolderAsZip({
            owner: urlInfo.owner,
            repo: urlInfo.repo,
            ref: btnRef,
            path: btnPath,
            githubApi: githubApiClient,
            onProgress: (status, message, percent) => {
              console.log(`[Folder Download] ${status}: ${message} (${percent}%)`);
              downloadBtn.title = `${message} (${percent}%)`;
            }
          });
        } catch (error) {
          console.error('[Folder Download] Error:', error);
          alert(`Failed to download folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
          downloadBtn.disabled = false;
          downloadBtn.innerHTML = `
            <svg class="octicon" viewBox="0 0 16 16" width="16" height="16">
              <path d="M7.47 10.78a.75.75 0 0 0 1.06 0l3.75-3.75a.75.75 0 0 0-1.06-1.06L8.75 8.44V1.75a.75.75 0 0 0-1.5 0v6.69L4.78 5.97a.75.75 0 0 0-1.06 1.06l3.75 3.75ZM3.75 13a.75.75 0 0 0 0 1.5h8.5a.75.75 0 0 0 0-1.5h-8.5Z"></path>
            </svg>
          `;
          downloadBtn.title = `Download ${btnFilename} as ZIP`;
        }
      } else {
        // Download file directly using GitHub API
        if (btnFileSha && githubApiClient) {
          try {
            downloadBtn.disabled = true;

            console.log('[File Download] Fetching via API with SHA:', btnFileSha);

            // Fetch the file content using blob API (supports authentication)
            const blobData = await githubApiClient.getJson<{ content: string; encoding: string }>(
              `/repos/${urlInfo.owner}/${urlInfo.repo}/git/blobs/${btnFileSha}`
            );

            // Decode base64 content
            const content = atob(blobData.content);

            // Convert to blob
            const bytes = new Uint8Array(content.length);
            for (let i = 0; i < content.length; i++) {
              bytes[i] = content.charCodeAt(i);
            }
            const blob = new Blob([bytes]);
            const blobUrl = URL.createObjectURL(blob);

            // Create download link
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = btnFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Clean up blob URL
            URL.revokeObjectURL(blobUrl);
            console.log('[File Download] File downloaded successfully via API');
          } catch (error) {
            console.error('[File Download] Error:', error);
            alert(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
          } finally {
            downloadBtn.disabled = false;
          }
        } else if (downloadUrl) {
          // Fallback to raw URL for public repos if no sha available
          console.warn('[File Download] No SHA available, falling back to raw URL (may fail for private repos)');
          try {
            downloadBtn.disabled = true;

            const response = await fetch(downloadUrl);
            if (!response.ok) {
              throw new Error('Failed to fetch file');
            }

            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = btnFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            URL.revokeObjectURL(blobUrl);
          } catch (error) {
            console.error('[File Download] Error:', error);
            alert(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
          } finally {
            downloadBtn.disabled = false;
          }
        } else {
          console.error('[File Download] No download method available - no SHA and no URL');
        }
      }
    });

    infoContainer.appendChild(downloadBtn);
  }

  // Insert into DOM
  if (element.matches('tr.react-directory-row')) {
    const newCell = document.createElement('td');
    newCell.className = 'hq-file-info-cell';
    newCell.appendChild(infoContainer);
    element.appendChild(newCell);
  } else if (element.matches('.PRIVATE_TreeView-item')) {
    const itemContent = element.querySelector('.PRIVATE_TreeView-item-content');
    if (itemContent) {
      itemContent.appendChild(infoContainer);
    }
  }
}

export const fileDownloadsFeature: Feature = {
  id: "file-downloads",
  name: "File Downloads & Sizes",
  description: "Displays file and folder sizes in repository listings with one-click download buttons. Features smart caching based on commit timestamps to minimize API usage and work efficiently even when rate-limited.",
  tags: ["ui", "files", "productivity", "downloads", "api"],
  pageTypes: ["repo", "code"],
  isEnabledByDefault: true,
  requiresPAT: true,
  options: [
    {
      key: "showFileSize",
      label: "Show File/Folder Sizes",
      description: "Display size information next to files and folders. Sizes are cached based on last commit time for efficient performance.",
      type: "boolean",
      defaultValue: true
    },
    {
      key: "showDownloadButton",
      label: "Show Download Buttons",
      description: "Add download buttons for individual files and folders (as ZIP). Downloads work directly without navigating away from the page.",
      type: "boolean",
      defaultValue: true
    }
  ],

  async init(ctx, settings) {
    // Store GitHub API client reference for use in API calls
    githubApiClient = ctx.githubApi;

    // Add header column and fix colspan
    const addHeaderColumn = () => {
      // Find the actual header row with <th> elements
      const tableHeaders = document.querySelectorAll('thead tr');
      let headerRow: Element | null = null;

      // Find the row that has <th> elements (column headers)
      for (const tr of tableHeaders) {
        if (tr.querySelector('th')) {
          headerRow = tr;
          break;
        }
      }

      if (headerRow && !headerRow.querySelector('.hq-downloads-header')) {
        const th = document.createElement('th');
        th.className = 'hq-downloads-header';
        th.setAttribute('aria-label', 'Downloads');
        th.style.cssText = 'width: 150px;';
        headerRow.appendChild(th);
      }

      // Update colspan from 3 to 4 and ensure content stays left-aligned
      const colspanCells = document.querySelectorAll('table[aria-labelledby="folders-and-files"] td[colspan="3"]');
      colspanCells.forEach(cell => {
        if (!cell.hasAttribute('data-hq-colspan-fixed')) {
          cell.setAttribute('colspan', '4');
          cell.setAttribute('data-hq-colspan-fixed', 'true');
        }
      });
    };

    // Add header on initial load and periodically check
    setTimeout(addHeaderColumn, 100);
    setTimeout(addHeaderColumn, 500);
    setTimeout(addHeaderColumn, 1000);

    // Watch for table header changes
    const headerObserver = new MutationObserver(() => {
      addHeaderColumn();
    });

    const observeHeader = () => {
      const table = document.querySelector('table[aria-labelledby="folders-and-files"]');
      if (table) {
        headerObserver.observe(table, { childList: true, subtree: true });
      }
    };

    setTimeout(observeHeader, 100);

    injectStyles(`
      .hq-downloads-header {
        width: 150px !important;
      }

      /* Ensure colspan cells stay left-aligned */
      table[aria-labelledby="folders-and-files"] td[colspan="4"][data-hq-colspan-fixed] {
        text-align: left !important;
      }

      /* Target the latest commit container to prevent flexbox spreading */
      table[aria-labelledby="folders-and-files"] td[colspan="4"][data-hq-colspan-fixed] div[class*="LatestCommit"] {
        max-width: calc(100% - 150px) !important;
      }

      .hq-file-info-cell {
        padding: 8px 16px !important;
        text-align: right !important;
        white-space: nowrap !important;
        width: 150px !important;
      }

      .hq-file-info {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        justify-content: flex-end;
      }

      .hq-file-size {
        font-size: 12px;
        color: var(--fgColor-muted, #656d76);
        font-family: ui-monospace, monospace;
      }

      .hq-download-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border-radius: 6px;
        color: var(--fgColor-muted, #656d76);
        background: transparent;
        border: 1px solid var(--borderColor-default, #d0d7de);
        cursor: pointer;
        text-decoration: none;
        transition: background 0.2s, border-color 0.2s;
      }

      .hq-download-btn:hover {
        background: var(--bgColor-muted, #f6f8fa);
        border-color: var(--borderColor-emphasis, #1f2328);
        color: var(--fgColor-default, #1f2328);
      }

      .hq-download-btn svg {
        fill: currentColor;
      }

      /* Loading spinner */
      .hq-loading-spinner {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--fgColor-muted, #656d76);
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      /* For tree view */
      .PRIVATE_TreeView-item-content {
        display: flex;
        align-items: center;
        width: 100%;
      }
    `, "file-downloads");

    observeAndProcess(
      [
        'tbody.react-directory-tbody',
        'tr.react-directory-row',
        '.PRIVATE_TreeView',
        '.PRIVATE_TreeView-item'
      ],
      (element) => {
        if (element.matches('tr.react-directory-row') || element.matches('.PRIVATE_TreeView-item')) {
          addDownloadInfo(element, settings);
        } else {
          // Container element, process children
          const rows = element.querySelectorAll('tr.react-directory-row');
          rows.forEach(row => addDownloadInfo(row, settings));

          const treeItems = element.querySelectorAll('.PRIVATE_TreeView-item');
          treeItems.forEach(item => addDownloadInfo(item, settings));
        }
      }
    );
  }
};
