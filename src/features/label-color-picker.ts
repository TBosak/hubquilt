import type { Feature } from "../core/feature-types";
import { observeAndProcess } from "../core/dom-observer";
import { injectStyles, createElement } from "../core/dom-utils";

function findColorInput(container: Element): HTMLInputElement | null {
  // 1. New GitHub label color picker (module CSS classes)
  const moduleSelectors = [
    '[class^="LabelColorPicker-module__container"] input[type="text"][data-component="input"]',
    '[class*="LabelColorPicker-module__container"] input[type="text"][data-component="input"]',
    '[class^="LabelColorPicker-module__inputContainer"] input[type="text"][data-component="input"]',
    '[class*="LabelColorPicker-module__inputContainer"] input[type="text"][data-component="input"]',
  ];

  for (const selector of moduleSelectors) {
    const input = container.querySelector<HTMLInputElement>(selector);
    if (input && !input.dataset.ghLabelPickerAdded) {
      const label = container.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`);
      if (!label || /color/i.test(label.textContent || "")) {
        return input;
      }
    }
  }

  // 2. Legacy / fallback selectors (old GitHub UI, or other places)
  const fallbackSelectors = [
    'input[id*="label"][id*="color"]',
    'input[name*="color"]',
    '.js-new-label-color-input',
    'input[name="label[color]"]',
    'input[placeholder*="color" i]',
    'input[type="text"][maxlength="6"]',
    '.js-label-color-input'
  ];

  for (const selector of fallbackSelectors) {
    const input = container.querySelector<HTMLInputElement>(selector);
    if (input && !input.dataset.ghLabelPickerAdded) {
      return input;
    }
  }

  return null;
}

function addColorPicker(container: Element) {
  const hexInput = findColorInput(container);
  if (!hexInput) return;

  hexInput.dataset.ghLabelPickerAdded = "true";

  const initialHex = hexInput.value.replace(/^#/, "") || "ffffff";
  const initialColor = `#${initialHex.padEnd(6, "0")}`;

  // --- Visible swatch wrapper ---
  const wrapper = createElement("div", {
    className: "gh-label-color-wrapper",
    title: "Pick a color"
  }) as HTMLDivElement;

  const swatch = createElement("div", {
    className: "gh-label-color-swatch"
  }) as HTMLDivElement;
  swatch.style.backgroundColor = initialColor;

  // --- Font Awesome–style magnifying glass icon ---
  const svgNS = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(svgNS, "svg");
  icon.setAttribute("viewBox", "0 0 512 512");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.classList.add("gh-label-color-icon");

  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("fill", "currentColor");
  // FA-like magnifying glass path
  path.setAttribute(
    "d",
    "M500.3 443.7 400.6 344c28.4-34.5 45.4-79 45.4-127.4C446 103.5 346.5 4 223 4S0 103.5 0 216s99.5 212 223 212c48.4 0 92.9-17 127.4-45.4l99.7 99.7c4.7 4.7 10.9 7 17 7s12.3-2.3 17-7c9.4-9.4 9.4-24.6 0-33.9zM223 360c-79.4 0-144-64.6-144-144S143.6 72 223 72s144 64.6 144 144-64.6 144-144 144z"
  );
  icon.appendChild(path);

  swatch.appendChild(icon);

  // Invisible native color input (just to open the picker)
  const colorPicker = createElement("input", {
    attributes: {
      type: "color",
      value: initialColor
    },
    className: "gh-label-color-input"
  }) as HTMLInputElement;

  wrapper.appendChild(swatch);
  wrapper.appendChild(colorPicker);

  // When user picks a color via native picker
  colorPicker.addEventListener("input", () => {
    const color = colorPicker.value.toLowerCase(); // '#rrggbb'
    hexInput.value = color;
    swatch.style.backgroundColor = color;

    hexInput.dispatchEvent(new Event("input", { bubbles: true }));
    hexInput.dispatchEvent(new Event("change", { bubbles: true }));
    hexInput.dispatchEvent(new Event("blur", { bubbles: true }));

    const reactKey = Object.keys(hexInput).find(key => key.startsWith("__react"));
    if (reactKey) {
      hexInput.dispatchEvent(
        new InputEvent("input", { bubbles: true, cancelable: true })
      );
    }
  });

  // When user types into the hex input directly
  hexInput.addEventListener("input", () => {
    const hex = hexInput.value.replace(/^#/, "");
    if (/^[0-9a-f]{3,6}$/i.test(hex)) {
      const fullHex =
        hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
      const color = `#${fullHex.padEnd(6, "0").toLowerCase()}`;
      colorPicker.value = color;
      swatch.style.backgroundColor = color;
    }
  });

  const parent = hexInput.parentElement;
  if (parent) {
    parent.style.display = "flex";
    parent.style.gap = "8px";
    parent.style.alignItems = "center";
    parent.appendChild(wrapper);
  }
}


export const labelColorPickerFeature: Feature = {
  id: "label-color-picker",
  name: "Label Color Picker",
  description: "Adds a native color picker to label creation/editing for easy color selection.",
  tags: ["ui", "labels", "productivity"],
  pageTypes: ["repo"],
  isEnabledByDefault: true,

  init() {
    injectStyles(`
      /* Hide GitHub's native color picker popup */
      [class*="LabelColorPicker-module__popup"] {
        display: none !important;
      }

      .gh-label-color-wrapper {
        position: relative;
        width: 40px;
        height: 32px;
        border: 1px solid var(--borderColor-default, #d0d7de);
        border-radius: 6px;
        overflow: hidden;
        flex-shrink: 0;
        cursor: pointer;
      }

      .gh-label-color-swatch {
        width: 100%;
        height: 100%;
        border-radius: 6px;
        position: relative;
      }

      .gh-label-color-input {
        position: absolute;
        inset: 0;
        opacity: 0;
        cursor: pointer;
        border: 0;
        padding: 0;
        margin: 0;
      }

      .gh-label-color-icon {
        position: absolute;
        inset: 0;
        width: 14px;
        height: 14px;
        margin: auto;
        pointer-events: none; /* don't block clicks */
        color: #ffffff;
        filter: drop-shadow(0 0 2px rgba(0,0,0,0.6));
      }
    `, "label-color-picker");

    observeAndProcess(
      [
        '[class^="LabelColorPicker-module__container"]',
        '[class*="LabelColorPicker-module__container"]',
        'form',
        'dialog',
        '[role="dialog"]',
        '.Overlay-body',
        '.js-new-label-form',
        '.js-edit-label-form'
      ],
      (container) => {
        addColorPicker(container);
      }
    );
  }
};
