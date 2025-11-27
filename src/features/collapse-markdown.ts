import type { Feature } from "../core/feature-types";
import { observeAndProcess } from "../core/dom-observer";
import { injectStyles } from "../core/dom-utils";

function getHeaderLevel(el: Element): number {
  return parseInt(el.tagName[1]) || 0;
}

// Wrapper block for a header (GitHub uses .markdown-heading)
function getHeaderBlock(header: Element): Element {
  return header.closest(".markdown-heading") ?? header;
}

// Find the *wrapper block* of the next header at level <= current
function findNextHeaderBlock(currentHeader: Element, level: number): Element | null {
  const currentBlock = getHeaderBlock(currentHeader);
  let sibling: Element | null = currentBlock.nextElementSibling;

  while (sibling) {
    let siblingHeader: Element | null = null;

    if (sibling.matches(".markdown-heading")) {
      siblingHeader = sibling.querySelector("h1,h2,h3,h4,h5,h6");
    } else if (/^H[1-6]$/.test(sibling.tagName)) {
      siblingHeader = sibling;
    }

    if (siblingHeader) {
      const siblingLevel = getHeaderLevel(siblingHeader);
      if (siblingLevel <= level) {
        return sibling; // return the block containing that header
      }
    }

    sibling = sibling.nextElementSibling;
  }

  return null;
}

function toggleHeader(header: Element, forceState?: boolean) {
  const headerBlock = getHeaderBlock(header);

  const isCollapsed = header.classList.contains("ghcm-collapsed");
  const newState = forceState !== undefined ? !forceState : !isCollapsed;

  header.classList.toggle("ghcm-collapsed", newState);

  const level = getHeaderLevel(header);
  const nextBlock = findNextHeaderBlock(header, level);

  // Hide/show everything between this header's block and the next header block
  let sibling = headerBlock.nextElementSibling;
  while (sibling && sibling !== nextBlock) {
    (sibling as HTMLElement).style.display = newState ? "none" : "";
    sibling = sibling.nextElementSibling;
  }
}

function addCollapseArrows(container: Element) {
  const headers = container.querySelectorAll("h1, h2, h3, h4, h5, h6");

  headers.forEach(header => {
    if (header.classList.contains("ghcm-header")) return;

    const level = getHeaderLevel(header);
    const headerBlock = getHeaderBlock(header);
    const nextBlock = findNextHeaderBlock(header, level);
    const hasContent =
      headerBlock.nextElementSibling && headerBlock.nextElementSibling !== nextBlock;

    if (!hasContent) {
      header.classList.add("ghcm-no-content");
      return;
    }

    header.classList.add("ghcm-header");

    const arrow = document.createElement("span");
    arrow.className = "ghcm-arrow";
    arrow.textContent = "▼";
    header.insertBefore(arrow, header.firstChild);

    header.addEventListener("click", e => {
      if ((e.target as Element).closest("a, img, svg")) return;

      e.preventDefault();

      if (e.shiftKey) {
        const allHeaders = container.querySelectorAll(`h${level}`);
        const firstState = !header.classList.contains("ghcm-collapsed");
        allHeaders.forEach(h => toggleHeader(h, firstState));
      } else {
        toggleHeader(header);
      }

      window.getSelection()?.removeAllRanges();
    });
  });

  // Auto-expand headers matching hash (best-effort)
  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target) {
      let parent = target.parentElement;
      while (parent && parent !== container) {
        if (
          /^H[1-6]$/.test(parent.tagName) &&
          parent.classList.contains("ghcm-collapsed")
        ) {
          toggleHeader(parent, true);
        }
        parent = parent.parentElement;
      }
    }
  }
}

export const collapseMarkdownFeature: Feature = {
  id: "collapse-markdown",
  name: "Collapse Markdown",
  description:
    "Add collapse/expand arrows to markdown headers. Shift+click to toggle all at same level.",
  tags: ["ui", "markdown", "productivity"],
  pageTypes: ["repo", "issue", "pull", "code"],
  isEnabledByDefault: true,

  init() {
    injectStyles(
      `
      .ghcm-header { position:relative; cursor:pointer; }
      .ghcm-header:hover { background:var(--bgColor-muted,#f6f8fa); }
      .ghcm-arrow {
        display:inline-block; width:0.6em; margin-right:0.3em;
        transition:transform 0.2s, opacity 0.2s; user-select:none; font-size:0.75em;
        opacity: 0.25;
      }
      .ghcm-header:hover .ghcm-arrow { opacity: 0.5; }
      .ghcm-collapsed .ghcm-arrow { transform:rotate(-90deg); }
      .ghcm-no-content { opacity:0.5; }
    `,
      "collapse-markdown"
    );

    observeAndProcess([".markdown-body", ".markdown-format"], addCollapseArrows);
  }
};
