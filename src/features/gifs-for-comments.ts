import type { Feature } from "../core/feature-types";
import { observeAndProcess } from "../core/dom-observer";
import { injectStyles, createElement } from "../core/dom-utils";

// GIPHY API - using the public beta key from the original extension
const GIPHY_API_KEY = 'SbEzuOMBzfBoT3Ys6kUpypCk7n406OnT';
const GIPHY_API_BASE = 'https://api.giphy.com/v1/gifs';
const MAX_GIF_WIDTH = 145;
const GITHUB_MAX_SIZE = 5 * 1024 * 1024; // 5MB limit for GitHub image proxy

// Simple debounce function
function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function (this: any, ...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Fetch trending GIFs from GIPHY
async function getTrendingGifs(offset = 0): Promise<any[]> {
  try {
    const response = await fetch(
      `${GIPHY_API_BASE}/trending?api_key=${GIPHY_API_KEY}&limit=50&offset=${offset}`
    );
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching trending GIFs:', error);
    return [];
  }
}

// Search GIFs from GIPHY
async function searchGifs(query: string, offset = 0): Promise<any[]> {
  try {
    const response = await fetch(
      `${GIPHY_API_BASE}/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=50&offset=${offset}`
    );
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error searching GIFs:', error);
    return [];
  }
}

// Get the best URL for a GIF based on size constraints
function getBestGifUrl(gif: any): string {
  const original = gif.images?.original;
  const downsizedMedium = gif.images?.downsized_medium;
  const fixedWidth = gif.images?.fixed_width;
  const downsampledUrl = gif.images?.fixed_width_downsampled?.url || fixedWidth?.url;

  if (original?.size && original.size < GITHUB_MAX_SIZE) {
    return original.url;
  } else if (downsizedMedium?.size && downsizedMedium.size < GITHUB_MAX_SIZE) {
    return downsizedMedium.url;
  } else if (fixedWidth?.size && fixedWidth.size < GITHUB_MAX_SIZE) {
    return fixedWidth.url;
  }

  return downsampledUrl || original?.url || '';
}

// Create a GIF thumbnail element
function createGifThumbnail(gif: any): HTMLElement {
  const fullSizeUrl = getBestGifUrl(gif);
  const thumbnailUrl = gif.images?.fixed_width_downsampled?.url || gif.images?.fixed_width?.url;
  const fixedWidth = gif.images?.fixed_width;

  const height = fixedWidth?.height && fixedWidth?.width
    ? Math.floor((fixedWidth.height * MAX_GIF_WIDTH) / fixedWidth.width)
    : MAX_GIF_WIDTH;

  const wrapper = createElement('div', {
    className: 'ghg-gif-item',
    styles: { width: `${MAX_GIF_WIDTH}px` }
  }) as HTMLDivElement;

  const img = createElement('img', {
    attributes: {
      src: thumbnailUrl,
      'data-full-url': fullSizeUrl,
      height: height.toString()
    },
    className: 'ghg-gif-thumbnail'
  }) as HTMLImageElement;

  wrapper.appendChild(img);
  return wrapper;
}

// Insert text into textarea
function insertText(textarea: HTMLTextAreaElement | HTMLElement, text: string) {
  textarea.focus();

  if (textarea instanceof HTMLTextAreaElement) {
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const value = textarea.value;

    textarea.value = value.substring(0, start) + text + value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;

    // Trigger events for React/GitHub
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// Find the textarea associated with a form
function findTextarea(form: Element): HTMLTextAreaElement | null {
  const selectors = [
    '.js-comment-field',
    '[name="issue[body]"]',
    '[name="pull_request[body]"]',
    '[name="comment[body]"]',
    '[name="discussion[body]"]',
    'textarea'
  ];

  return form.querySelector(selectors.join(','));
}

// Add GIF button to toolbar
function addGifButton(toolbar: Element) {
  // Check if already added
  if (toolbar.querySelector('.ghg-trigger') || toolbar.classList.contains('ghg-has-gif-button')) {
    return;
  }

  // Find the form and textarea
  let form = toolbar.closest('form, .js-previewable-comment-form, [role="form"]');
  let textarea: HTMLTextAreaElement | null = null;

  if (!form) {
    let current: Element | null = toolbar;
    while (current && current !== document.body) {
      const nearestTextArea = current.querySelector<HTMLTextAreaElement>('textarea');
      if (nearestTextArea) {
        form = current;
        textarea = nearestTextArea;
        break;
      }
      current = current.parentElement;
    }
  } else {
    textarea = findTextarea(form);
  }

  if (!form || !textarea) {
    return;
  }

  if (form.classList.contains('ghg-has-gif-field')) {
    return;
  }

  // Find where to insert the button - look for ActionBar item container
  let itemContainer = toolbar.querySelector('.ActionBar-item-container, [data-target="action-bar.itemContainer"]');

  if (!itemContainer) {
    // Fallback: try to find action-bar and get its item container
    const actionBar = toolbar.querySelector('action-bar');
    if (actionBar) {
      itemContainer = actionBar.querySelector('.ActionBar-item-container, [data-target="action-bar.itemContainer"]');
    }
  }

  if (!itemContainer) {
    // Last fallback: append to toolbar itself
    itemContainer = toolbar;
  }

  // Create the GIF picker button
  const button = createGifPicker(form as HTMLElement, textarea);

  // Insert before the last divider or at the end
  const dividers = itemContainer.querySelectorAll('.ActionBar-divider, hr[role="presentation"]');
  const lastDivider = dividers[dividers.length - 1];

  if (lastDivider) {
    itemContainer.insertBefore(button, lastDivider);
  } else {
    itemContainer.appendChild(button);
  }

  toolbar.classList.add('ghg-has-gif-button');
  form.classList.add('ghg-has-gif-field');
}

// Create the GIF picker UI
function createGifPicker(form: HTMLElement, textarea: HTMLTextAreaElement): HTMLElement {
  // Create wrapper div for ActionBar
  const wrapper = createElement('div', {
    className: 'ActionBar-item',
    attributes: {
      'data-targets': 'action-bar.items',
      'data-view-component': 'true'
    },
    styles: { visibility: 'visible' }
  }) as HTMLDivElement;

  const details = createElement('details', {
    className: 'details-reset details-overlay toolbar-item ghg-trigger'
  }) as HTMLDetailsElement;

  const summary = createElement('summary', {
    className: 'menu-target Button Button--iconOnly Button--invisible Button--medium',
    attributes: {
      'aria-label': 'Insert a GIF',
      'aria-haspopup': 'menu',
      'type': 'button'
    }
  }) as HTMLElement;
  summary.textContent = 'GIF';

  const modal = createElement('div', {
    className: 'ghg-modal',
    attributes: {
      role: 'menu'
    }
  }) as HTMLDivElement;

  // Modal header
  const header = createElement('div', {
    className: 'ghg-header'
  }) as HTMLDivElement;

  const title = createElement('span', {
    className: 'ghg-title'
  }) as HTMLSpanElement;
  title.textContent = 'Select a GIF';

  const poweredBy = createElement('span', {
    className: 'ghg-powered-by'
  }) as HTMLSpanElement;
  poweredBy.textContent = 'Powered by GIPHY';

  header.appendChild(title);
  header.appendChild(poweredBy);

  // Search input
  const searchContainer = createElement('div', {
    className: 'ghg-search-container'
  }) as HTMLDivElement;

  const searchInput = createElement('input', {
    className: 'form-control ghg-search-input',
    attributes: {
      type: 'search',
      placeholder: 'Search for a GIF…',
      'aria-label': 'Search for a GIF'
    }
  }) as HTMLInputElement;

  searchContainer.appendChild(searchInput);

  // Results container
  const resultsContainer = createElement('div', {
    className: 'ghg-results'
  }) as HTMLDivElement;
  resultsContainer.dataset.offset = '0';
  resultsContainer.dataset.query = '';
  resultsContainer.dataset.hasResults = 'false';

  modal.appendChild(header);
  modal.appendChild(searchContainer);
  modal.appendChild(resultsContainer);

  details.appendChild(summary);
  details.appendChild(modal);

  // Event: Open modal - load trending GIFs
  summary.addEventListener('click', async () => {
    if (!details.hasAttribute('open')) {
      // Will open after this event
      setTimeout(async () => {
        if (resultsContainer.dataset.hasResults === 'false' && searchInput.value === '') {
          await loadTrendingGifs(resultsContainer);
        }
      }, 10);
    }
  });

  // Event: Search input
  searchInput.addEventListener('input', debounce(async (e: Event) => {
    const query = (e.target as HTMLInputElement).value;
    resultsContainer.dataset.offset = '0';
    resultsContainer.dataset.query = query;

    if (query === '') {
      await loadTrendingGifs(resultsContainer);
    } else {
      await performSearch(resultsContainer, query);
    }
  }, 400));

  // Event: Prevent form submission on Enter
  searchInput.addEventListener('keypress', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
    }
  });

  // Event: Click on GIF
  resultsContainer.addEventListener('click', (e: Event) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('ghg-gif-thumbnail')) {
      const fullUrl = target.dataset.fullUrl;
      if (fullUrl) {
        insertText(textarea, `<img src="${fullUrl}"/>`);
        details.removeAttribute('open');
        searchInput.value = '';
        resultsContainer.innerHTML = '';
        resultsContainer.dataset.offset = '0';
        resultsContainer.dataset.query = '';
        resultsContainer.dataset.hasResults = 'false';
      }
    }
  });

  // Event: Infinite scroll
  resultsContainer.addEventListener('scroll', debounce(async () => {
    const scrollTop = resultsContainer.scrollTop;
    const scrollHeight = resultsContainer.scrollHeight;
    const clientHeight = resultsContainer.clientHeight;

    if (scrollTop + clientHeight >= scrollHeight - 100) {
      const offset = parseInt(resultsContainer.dataset.offset || '0', 10);
      const query = resultsContainer.dataset.query || '';
      const newOffset = offset + 50;

      resultsContainer.dataset.offset = newOffset.toString();

      let gifs: any[];
      if (query === '') {
        gifs = await getTrendingGifs(newOffset);
      } else {
        gifs = await searchGifs(query, newOffset);
      }

      appendGifs(resultsContainer, gifs);
    }
  }, 250));

  wrapper.appendChild(details);
  return wrapper;
}

// Load trending GIFs
async function loadTrendingGifs(container: HTMLElement) {
  container.innerHTML = '<div class="ghg-loading">Loading...</div>';

  const gifs = await getTrendingGifs();
  container.innerHTML = '';

  if (gifs.length > 0) {
    appendGifs(container, gifs);
    container.dataset.hasResults = 'true';
  } else {
    container.innerHTML = '<div class="ghg-no-results">No GIFs found.</div>';
  }
}

// Perform search
async function performSearch(container: HTMLElement, query: string) {
  container.innerHTML = '<div class="ghg-loading">Searching...</div>';

  const gifs = await searchGifs(query);
  container.innerHTML = '';

  if (gifs.length > 0) {
    appendGifs(container, gifs);
    container.dataset.hasResults = 'true';
  } else {
    container.innerHTML = '<div class="ghg-no-results">No GIFs found.</div>';
  }
}

// Append GIFs to container
function appendGifs(container: HTMLElement, gifs: any[]) {
  for (const gif of gifs) {
    const thumbnail = createGifThumbnail(gif);
    container.appendChild(thumbnail);
  }
}

export const gifsForCommentsFeature: Feature = {
  id: "gifs-for-comments",
  name: "GIFs for Comments",
  description: "Add a GIF picker button to comment toolbars, powered by GIPHY. Search and insert GIFs directly into comments, issues, and pull requests.",
  tags: ["ui", "comments", "productivity"],
  pageTypes: ["repo", "issue", "pull"],
  isEnabledByDefault: true,

  init() {
    injectStyles(`
      /* GIF picker button */
      .ghg-trigger {
        position: relative;
      }

      .ghg-trigger summary {
        font-weight: 600;
        font-size: 13px;
        padding: 5px 12px;
      }

      /* Modal */
      .ghg-modal {
        position: absolute;
        right: 0;
        z-index: 99;
        width: 480px;
        max-height: 410px;
        background: var(--bgColor-default, #ffffff);
        border: 1px solid var(--borderColor-default, #d0d7de);
        border-radius: 6px;
        box-shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
        margin-top: 8px;
      }

      /* Header */
      .ghg-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--borderColor-default, #d0d7de);
      }

      .ghg-title {
        font-weight: 600;
        font-size: 14px;
        color: var(--fgColor-default, #1f2328);
      }

      .ghg-powered-by {
        font-size: 11px;
        color: var(--fgColor-muted, #656d76);
      }

      /* Search */
      .ghg-search-container {
        padding: 12px 16px;
      }

      .ghg-search-input {
        width: 100%;
      }

      /* Results */
      .ghg-results {
        padding: 0 16px 16px;
        overflow-y: auto;
        max-height: 285px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-content: flex-start;
      }

      .ghg-results::-webkit-scrollbar {
        width: 8px;
      }

      .ghg-results::-webkit-scrollbar-track {
        background: var(--bgColor-muted, #f6f8fa);
      }

      .ghg-results::-webkit-scrollbar-thumb {
        background: var(--borderColor-default, #d0d7de);
        border-radius: 4px;
      }

      .ghg-results::-webkit-scrollbar-thumb:hover {
        background: var(--borderColor-emphasis, #858c94);
      }

      .ghg-gif-item {
        cursor: pointer;
        border-radius: 4px;
        overflow: hidden;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .ghg-gif-item:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .ghg-gif-thumbnail {
        width: 100%;
        display: block;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      }

      .ghg-loading,
      .ghg-no-results {
        width: 100%;
        padding: 40px 20px;
        text-align: center;
        color: var(--fgColor-muted, #656d76);
      }

      /* Fix overflow issues in review modals */
      .ghg-has-gif-field {
        overflow: visible !important;
      }

      .ghg-has-gif-field .Overlay-body {
        overflow-y: visible !important;
      }

      [class*="prc-Dialog-Body-"] {
        overflow: visible !important;
      }

      [class*="prc-Overlay-Overlay"] {
        overflow: visible !important;
      }

      .ActionBar-item-container {
        overflow: visible !important;
      }

      .ghg-has-gif-field [class*="Toolbar-module__toolbar"] {
        justify-content: flex-end !important;
      }
    `, "gifs-for-comments");

    // Observe toolbars
    observeAndProcess(
      [
        '[aria-label="Formatting tools"]',
        'markdown-toolbar'
      ],
      (toolbar) => {
        addGifButton(toolbar);
      }
    );
  }
};
