/**
 * Process existing elements matching selectors and watch for new ones via MutationObserver.
 *
 * @param selectors - CSS selector(s) to match elements
 * @param processor - Function to process each matching element
 * @param root - Root element to observe (defaults to document.body)
 * @returns MutationObserver instance (can be used to disconnect if needed)
 *
 * @example
 * // Simple usage with single selector
 * observeAndProcess(".markdown-body", (el) => addFeature(el));
 *
 * @example
 * // Multiple selectors
 * observeAndProcess([".markdown-body", ".comment-body"], (el) => processElement(el));
 *
 * @example
 * // With closure for additional arguments
 * observeAndProcess(".code-block", (el) => processBlock(el, minLines, options));
 */
export function observeAndProcess(
  selectors: string | string[],
  processor: (element: Element) => void,
  root: Element = document.body
): MutationObserver {
  const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
  const selectorString = selectorArray.join(", ");

  // Process existing elements
  const existingElements = document.querySelectorAll(selectorString);
  existingElements.forEach(processor);

  // Watch for new elements
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node instanceof Element) {
          // Check if the node itself matches
          if (selectorArray.some(selector => node.matches(selector))) {
            processor(node);
          }

          // Check children
          const matchingChildren = node.querySelectorAll(selectorString);
          matchingChildren.forEach(processor);
        }
      });
    });
  });

  observer.observe(root, { childList: true, subtree: true });

  return observer;
}
