/**
 * DOM utility functions for common patterns across features
 */

const injectedStyles = new Set<string>();

/**
 * Inject CSS styles into the document head.
 * Prevents duplicate injection by tracking injected style IDs.
 *
 * @param css - The CSS string to inject
 * @param id - Optional unique ID to prevent duplicate injection (defaults to hash of css)
 *
 * @example
 * injectStyles(`
 *   .my-class { color: red; }
 * `, 'my-feature-styles');
 */
export function injectStyles(css: string, id?: string): void {
  const styleId = id || `style-${hashString(css)}`;

  // Prevent duplicate injection
  if (injectedStyles.has(styleId)) {
    return;
  }

  const style = document.createElement("style");
  style.setAttribute("data-style-id", styleId);
  style.textContent = css;
  document.head.appendChild(style);

  injectedStyles.add(styleId);
}

/**
 * Simple string hash function for generating style IDs
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Query for an element using multiple fallback selectors.
 * Returns the first element found from the list of selectors.
 *
 * @param selectors - Array of CSS selectors to try in order
 * @param context - Context element to query within (defaults to document)
 * @returns First matching element or null
 *
 * @example
 * const title = querySelector([
 *   'h1 strong[itemprop="name"]',
 *   'h1 strong a',
 *   'h1.heading-element'
 * ]);
 */
export function querySelector<T extends Element = Element>(
  selectors: string[],
  context: Document | Element = document
): T | null {
  for (const selector of selectors) {
    const element = context.querySelector<T>(selector);
    if (element) return element;
  }
  return null;
}

/**
 * Create an element with properties set in one call.
 * Cleaner than multiple property assignments.
 *
 * @param tag - HTML tag name
 * @param options - Element properties to set
 * @returns Created element
 *
 * @example
 * const button = createElement('button', {
 *   className: 'my-btn',
 *   textContent: 'Click me',
 *   title: 'Tooltip text',
 *   attributes: { 'data-id': '123' },
 *   styles: { padding: '8px', color: 'red' }
 * });
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    textContent?: string;
    title?: string;
    attributes?: Record<string, string>;
    styles?: Partial<CSSStyleDeclaration>;
    onClick?: (event: MouseEvent) => void;
  } = {}
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (options.className) {
    element.className = options.className;
  }

  if (options.textContent !== undefined) {
    element.textContent = options.textContent;
  }

  if (options.title) {
    element.title = options.title;
  }

  if (options.attributes) {
    for (const [key, value] of Object.entries(options.attributes)) {
      element.setAttribute(key, value);
    }
  }

  if (options.styles) {
    for (const [key, value] of Object.entries(options.styles)) {
      if (value !== undefined) {
        (element.style as any)[key] = value;
      }
    }
  }

  if (options.onClick) {
    element.addEventListener('click', options.onClick);
  }

  return element;
}

/**
 * Check if an element has already been processed by a feature.
 * Uses data attributes to mark processed elements.
 *
 * @param element - Element to check
 * @param featureId - Unique feature identifier
 * @returns true if already processed
 *
 * @example
 * if (isProcessed(header, 'collapse-markdown')) return;
 * markAsProcessed(header, 'collapse-markdown');
 */
export function isProcessed(element: Element, featureId: string): boolean {
  return element.hasAttribute(`data-${featureId}-processed`);
}

/**
 * Mark an element as processed by a feature.
 *
 * @param element - Element to mark
 * @param featureId - Unique feature identifier
 *
 * @example
 * markAsProcessed(header, 'collapse-markdown');
 */
export function markAsProcessed(element: Element, featureId: string): void {
  element.setAttribute(`data-${featureId}-processed`, 'true');
}

/**
 * Check if element has any of the given class names
 *
 * @param element - Element to check
 * @param classNames - Class names to check for
 * @returns true if element has any of the classes
 *
 * @example
 * if (hasAnyClass(node, ['markdown-body', 'comment-body'])) { ... }
 */
export function hasAnyClass(element: Element, classNames: string[]): boolean {
  return classNames.some(className => element.classList.contains(className));
}
