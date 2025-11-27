import type { Feature, FeatureOption } from "../core/feature-types";
import { observeAndProcess } from "../core/dom-observer";
import { injectStyles } from "../core/dom-utils";

function getLanguage(pre: Element): string {
  const classes = pre.className.split(/\s+/);
  for (const cls of classes) {
    if (cls.startsWith("language-")) {
      return cls.replace("language-", "").toUpperCase();
    }
  }
  const codeEl = pre.querySelector("code");
  if (codeEl) {
    const codeClasses = codeEl.className.split(/\s+/);
    for (const cls of codeClasses) {
      if (cls.startsWith("language-")) {
        return cls.replace("language-", "").toUpperCase();
      }
    }
  }
  return "CODE";
}

function countLines(el: Element): number {
  const text = el.textContent || "";
  return text.split("\n").length;
}

function addToggle(block: Element, label: string, initiallyCollapsed: boolean) {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "gcic-block" + (initiallyCollapsed ? " gcic-block-closed" : "");
  toggle.textContent = label;

  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey && e.ctrlKey || e.shiftKey && e.metaKey) {
      // Shift+Ctrl/Cmd: toggle all on page
      const all = document.querySelectorAll(".gcic-block");
      const firstState = !toggle.classList.contains("gcic-block-closed");
      all.forEach(t => t.classList.toggle("gcic-block-closed", firstState));
    } else if (e.shiftKey) {
      // Shift: toggle all in comment
      const comment = block.closest(".comment-body, .markdown-body");
      if (comment) {
        const toggles = comment.querySelectorAll(".gcic-block");
        const firstState = !toggle.classList.contains("gcic-block-closed");
        toggles.forEach(t => t.classList.toggle("gcic-block-closed", firstState));
      }
    } else {
      // Normal click: toggle this one
      toggle.classList.toggle("gcic-block-closed");
    }
  });

  block.parentElement?.insertBefore(toggle, block);
  block.classList.add("gcic-has-toggle");
}

function processBlocks(container: Element, minLines: number, initiallyCollapsed: boolean) {
  // Process code blocks
  const pres = container.querySelectorAll("pre");
  pres.forEach(pre => {
    if (pre.classList.contains("gcic-has-toggle")) return;

    const lines = countLines(pre);
    if (lines >= minLines) {
      const lang = getLanguage(pre);
      const label = `${lang} (${lines} lines)`;
      addToggle(pre, label, initiallyCollapsed);
    }
  });

  // Process blockquotes
  const quotes = container.querySelectorAll("blockquote");
  quotes.forEach(quote => {
    if (quote.classList.contains("gcic-has-toggle")) return;

    const lines = countLines(quote);
    if (lines >= minLines) {
      const label = `QUOTE (${lines} lines)`;
      addToggle(quote, label, initiallyCollapsed);
    }
  });

  // Process email signature replies
  const signatures = container.querySelectorAll(".email-signature-reply");
  signatures.forEach(sig => {
    if (sig.classList.contains("gcic-has-toggle")) return;

    const lines = countLines(sig);
    const label = `SIGNATURE (${lines} lines)`;
    addToggle(sig, label, true); // Always collapse signatures
  });
}

export const collapseInCommentFeature: Feature = {
  id: "collapse-in-comment",
  name: "Collapse In Comment",
  description: "Add collapse toggles to long code blocks and quotes.",
  tags: ["ui", "comments", "productivity"],
  pageTypes: ["issue", "pull", "repo"],
  isEnabledByDefault: true,

  options: [
    {
      key: "minLines",
      label: "Minimum Lines",
      description: "Minimum number of lines before adding collapse toggle",
      type: "number",
      defaultValue: 10,
      min: 3,
      max: 100
    },
    {
      key: "initiallyCollapsed",
      label: "Start Collapsed",
      description: "Start with blocks collapsed by default",
      type: "boolean",
      defaultValue: false
    }
  ],

  init(ctx, settings = {}) {
    injectStyles(`
      /* Force parent container to stack children vertically */
      .snippet-clipboard-content:has(.gcic-block):not([style*="display: none"]),
      .highlight:has(.gcic-block):not([style*="display: none"]),
      .markdown-body:has(.gcic-block):not([style*="display: none"]) {
        display: flex !important;
        flex-direction: column !important;
      }

      .gcic-block {
        display: block !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 8px 12px !important;
        background: #f6f8fa;
        border: 1px solid #d0d7de;
        border-radius: 6px 6px 0 0;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        user-select: none;
        color: #57606a !important;
        text-align: left;
        box-sizing: border-box;
        text-decoration: none !important;
        order: -1;
        flex-shrink: 0;
      }
      .gcic-block:hover {
        background: #eaeef2;
        text-decoration: none !important;
      }
      .gcic-block::before {
        content: "▼ ";
        transition: transform 0.2s;
        display: inline-block;
        margin-right: 6px;
      }
      .gcic-block-closed::before { transform: rotate(-90deg); }
      .gcic-block-closed + pre,
      .gcic-block-closed + blockquote,
      .gcic-block-closed + .email-signature-reply {
        display: none !important;
      }
      .gcic-has-toggle {
        border-radius: 0 0 6px 6px !important;
        margin-top: 0 !important;
        flex-shrink: 0;
      }
      @media (prefers-color-scheme: dark) {
        .gcic-block { background: #161b22; border-color: #30363d; color: #8d96a0 !important; }
        .gcic-block:hover { background: #21262d; }
      }
    `, 'collapse-in-comment');

    const minLines = settings.minLines ?? 10;
    const initiallyCollapsed = settings.initiallyCollapsed ?? false;

    observeAndProcess([".markdown-body", ".comment-body"], (el) =>
      processBlocks(el, minLines, initiallyCollapsed)
    );
  }
};
