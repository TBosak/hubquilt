import type { Feature } from "../core/feature-types";
import { observeAndProcess } from "../core/dom-observer";
import { injectStyles } from "../core/dom-utils";
import icons from "@exuanbo/file-icons-js";

const processedElements = new WeakSet<Element>();

// Browser compatibility: Use browser or chrome API
const runtimeApi = typeof browser !== "undefined" ? browser.runtime : chrome.runtime;

const fonts = [
  { name: 'file-icons', path: '/file-icons/fonts/file-icons.woff2' },
  { name: 'FontAwesome', path: '/file-icons/fonts/fontawesome.woff2' },
  { name: 'Devicons', path: '/file-icons/fonts/devopicons.woff2' },
  { name: 'Mfizz', path: '/file-icons/fonts/mfixx.woff2' },
  { name: 'Octicons Regular', path: '/file-icons/fonts/octicons.woff2' }
];

async function loadIconFonts() {
  const loadPromises = fonts.map(async (font) => {
    try {
      const fontUrl = runtimeApi.getURL(font.path);
      const fontFace = new FontFace(
        font.name,
        `url("${fontUrl}") format("woff2")`,
        { style: 'normal', weight: 'normal' }
      );

      const loadedFont = await fontFace.load();
      document.fonts.add(loadedFont);
    } catch (error) {
      console.error(`[HubQuilt File Icons] Failed to load font: ${font.name}`, error);
    }
  });

  await Promise.all(loadPromises);

  const cssUrl = runtimeApi.getURL("/file-icons/css/file-icons.min.css");
  const link = document.createElement("link");
  link.id = "file-icons-css";
  link.rel = "stylesheet";
  link.href = cssUrl;
  document.head.appendChild(link);
}

async function getIconClass(filename: string): Promise<string | null> {
  try {
    const className = await icons.getClass(filename);
    return className || null;
  } catch (error) {
    console.error("Error getting icon class:", error);
    return null;
  }
}

async function replaceFileIcon(element: Element, settings?: Record<string, any>) {
  if (processedElements.has(element)) {
    return;
  }

  let filename = '';
  let iconElement: Element | null = null;
  let matchedSelector = '';

  // GitHub react-directory-row: Rows have TWO cells (small-screen and large-screen)
  const allFilenameColumns = element.querySelectorAll('.react-directory-filename-column');
  if (allFilenameColumns.length > 0) {
    const filenameLink = element.querySelector('.react-directory-filename-column a[title]');
    if (filenameLink) {
      matchedSelector = 'react-directory-row';
      filename = filenameLink.getAttribute('title') || filenameLink.textContent?.trim() || '';

      for (const column of allFilenameColumns) {
        const columnIcon = column.querySelector('svg.octicon');
        if (columnIcon && !columnIcon.classList.contains('octicon-file-directory') &&
            !columnIcon.classList.contains('octicon-file-directory-fill')) {
          iconElement = columnIcon;
          break;
        }
      }
    }
  }

  // GitHub file tree
  if (!filename) {
    const treeItemContent = element.querySelector('.PRIVATE_TreeView-item-content-text > span');
    if (treeItemContent) {
      filename = treeItemContent.textContent?.trim() || '';
      iconElement = element.querySelector('.PRIVATE_TreeView-item-visual');
    }
  }

  // GitHub classic file list
  if (!filename) {
    const filenameSpan = element.querySelector('div[role="rowheader"] > span');
    if (filenameSpan) {
      filename = filenameSpan.textContent?.trim() || '';
      iconElement = element.querySelector('div[role="gridcell"]:first-child svg:not(.icon-directory)');
    }
  }

  // GitHub PR files
  if (!filename) {
    const prFileLink = element.querySelector('a > span:nth-child(2)');
    if (prFileLink) {
      filename = prFileLink.textContent?.trim() || '';
      iconElement = element.querySelector('a > span:first-child');
    }
  }

  if (!filename || !iconElement) {
    return;
  }

  if (iconElement.classList?.contains('octicon-file-directory') ||
      iconElement.classList?.contains('octicon-file-directory-fill') ||
      iconElement.classList?.contains('icon-directory')) {
    return;
  }

  const iconClass = await getIconClass(filename);
  if (!iconClass) {
    return;
  }

  if (matchedSelector === 'react-directory-row') {
    const allColumns = element.querySelectorAll('.react-directory-filename-column');

    for (const column of allColumns) {
      const svgIcon = column.querySelector('svg.octicon');
      if (svgIcon && !svgIcon.classList.contains('octicon-file-directory') &&
          !svgIcon.classList.contains('octicon-file-directory-fill')) {

        const customIcon = document.createElement('i');
        customIcon.className = iconClass;
        customIcon.title = filename;

        const colorScheme = settings?.colorScheme || 'colored';
        if (colorScheme === 'monochrome') {
          customIcon.classList.add('file-icon-monochrome');
        }

        if (svgIcon.parentNode) {
          svgIcon.parentNode.replaceChild(customIcon, svgIcon);
        }
      }
    }
  } else {
    if (!iconElement) return;

    const customIcon = document.createElement('i');
    customIcon.className = iconClass;
    customIcon.title = filename;

    const colorScheme = settings?.colorScheme || 'colored';
    if (colorScheme === 'monochrome') {
      customIcon.classList.add('file-icon-monochrome');
    }

    if (iconElement.parentNode) {
      iconElement.parentNode.replaceChild(customIcon, iconElement);
    }
  }

  processedElements.add(element);
  element.setAttribute('data-file-icon-added', 'true');
}

async function processFileList(container: Element, settings?: Record<string, any>) {
  const reactRows = container.querySelectorAll('tr.react-directory-row');
  if (reactRows.length > 0) {
    for (const row of reactRows) {
      await replaceFileIcon(row, settings);
    }
  }

  const treeItems = container.querySelectorAll('.PRIVATE_TreeView-item');
  if (treeItems.length > 0) {
    for (const item of treeItems) {
      await replaceFileIcon(item, settings);
    }
  }

  const fileItems = container.querySelectorAll('.js-navigation-item');
  if (fileItems.length > 0) {
    for (const item of fileItems) {
      await replaceFileIcon(item, settings);
    }
  }

  const prFiles = container.querySelectorAll('li[id^="file-tree-item-diff-"]');
  if (prFiles.length > 0) {
    for (const item of prFiles) {
      await replaceFileIcon(item, settings);
    }
  }
}

export const fileIconsFeature: Feature = {
  id: "file-icons",
  name: "File Icons",
  description: "Shows professional file-type icons from atom-file-icons in file browsers and pull requests, making it easier to identify files at a glance.",
  tags: ["ui", "files", "productivity"],
  pageTypes: ["repo", "pull", "code"],
  isEnabledByDefault: true,
  options: [
    {
      key: "colorScheme",
      label: "Color Scheme",
      description: "Choose between colored or monochrome icons",
      type: "select",
      defaultValue: "colored",
      options: [
        { value: "colored", label: "Colored" },
        { value: "monochrome", label: "Monochrome" }
      ]
    }
  ],

  async init(ctx, settings) {
    await loadIconFonts();

    injectStyles(`
      .react-directory-filename-column i[class*="icon-"],
      .react-directory-filename-column i[class*="devicons-"],
      .PRIVATE_TreeView-item-visual i[class*="icon-"],
      .PRIVATE_TreeView-item-visual i[class*="devicons-"] {
        display: inline-block !important;
        width: 16px !important;
        height: 16px !important;
        line-height: 1 !important;
        vertical-align: text-bottom !important;
        margin-right: 8px !important;
        font-size: 16px !important;
        text-align: center !important;
      }

      .react-directory-filename-column i::before,
      .PRIVATE_TreeView-item-visual i::before {
        display: inline-block !important;
      }

      .file-icon-monochrome {
        filter: grayscale(1);
        opacity: 0.7;
      }
    `, "file-icons-custom");

    // Scan for existing files with retry logic for GitHub's dynamic rendering
    const scanForExistingFiles = async (attempt = 1, maxAttempts = 5) => {
      const existingRows = document.querySelectorAll('tr.react-directory-row');

      if (existingRows.length > 0) {
        for (const row of existingRows) {
          await replaceFileIcon(row, settings);
        }
        return true;
      } else {
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 500));
          return scanForExistingFiles(attempt + 1, maxAttempts);
        } else {
          return false;
        }
      }
    };

    await scanForExistingFiles();

    observeAndProcess(
      [
        'tbody.react-directory-tbody',
        'table[aria-labelledby="folders-and-files"]',
        'div[data-hpc]',
        '.PRIVATE_TreeView',
        '.PRIVATE_TreeView-item',
        'tr.react-directory-row',
        '.js-navigation-container',
        '.js-navigation-item',
        'ul.ActionList',
        'li[id^="file-tree-item-diff-"]',
        'turbo-frame[id="repo-content-turbo-frame"]',
        'react-partial[partial-name="repos-overview"]'
      ],
      (container) => {
        if (container.matches('.PRIVATE_TreeView-item') ||
            container.matches('tr.react-directory-row') ||
            container.matches('.js-navigation-item') ||
            container.matches('li[id^="file-tree-item-diff-"]')) {
          replaceFileIcon(container, settings);
        } else {
          processFileList(container, settings);
        }
      }
    );
  }
};
