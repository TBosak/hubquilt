import type { Feature } from "../core/feature-types";
import { observeAndProcess } from "../core/dom-observer";
import { injectStyles } from "../core/dom-utils";

// Compact named colors list (browser handles the actual color values)
const namedColors = new Set([
  "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure", "beige", "bisque", "black",
  "blanchedalmond", "blue", "blueviolet", "brown", "burlywood", "cadetblue", "chartreuse",
  "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan", "darkblue",
  "darkcyan", "darkgoldenrod", "darkgray", "darkgrey", "darkgreen", "darkkhaki",
  "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon",
  "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise",
  "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue", "firebrick",
  "floralwhite", "forestgreen", "fuchsia", "gainsboro", "ghostwhite", "gold", "goldenrod",
  "gray", "grey", "green", "greenyellow", "honeydew", "hotpink", "indianred", "indigo",
  "ivory", "khaki", "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue",
  "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgrey", "lightgreen",
  "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray",
  "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen", "linen", "magenta",
  "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple",
  "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise",
  "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin", "navajowhite",
  "navy", "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid", "palegoldenrod",
  "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink",
  "plum", "powderblue", "purple", "rebeccapurple", "red", "rosybrown", "royalblue",
  "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna", "silver",
  "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen", "steelblue",
  "tan", "teal", "thistle", "tomato", "turquoise", "violet", "wheat", "white", "whitesmoke",
  "yellow", "yellowgreen"
]);

function createColorBlock(colorStr: string): HTMLElement | null {
  const block = document.createElement("span");
  block.className = "ghcc-block";
  block.style.backgroundColor = colorStr;
  block.title = colorStr;

  // Verify color is valid by checking if browser applied it
  if (!block.style.backgroundColor) return null;

  return block;
}

function extractColorFromText(txt: string): string {
  // Extract from CSS properties: "color: #fff" -> "#fff"
  const cssMatch = txt.match(/:\s*(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-z]+)\s*[;}]?$/i);
  if (cssMatch?.[1]) return cssMatch[1].trim();

  // Extract from strings: "rgb(255,0,0)" or "hsl(0,100%,50%)"
  const funcMatch = txt.match(/(?:rgba?|hsla?)\([^)]+\)/i);
  if (funcMatch) return funcMatch[0];

  return txt;
}

function processCodeColors(container: Element) {
  const elements = Array.from(container.querySelectorAll(".pl-c1, .pl-s, .pl-en, .pl-pds"));
  let lastText = "";

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];

    // Skip if already processed or nested
    if (el.querySelector(".ghcc-block") || el.closest(".ghcc-block") ||
        el.parentElement?.classList.contains("pl-c1")) continue;

    let txt = el.textContent?.trim().replace(/['"]/g, "") || "";

    // Skip Math.tan and similar (tan is a color)
    if (lastText.toLowerCase() === "math") {
      lastText = txt;
      continue;
    }

    const color = extractColorFromText(txt);

    // Check hex, named colors, or functional colors
    if (/^(#|0x)[0-9a-f]{3,8}$/i.test(color) ||
        namedColors.has(color.toLowerCase()) ||
        /^(?:rgba?|hsla?)\(/i.test(color)) {

      const normalized = color.replace(/^0x/, "#");
      const block = createColorBlock(normalized);
      if (block) el.insertBefore(block, el.firstChild);
    }

    lastText = txt;
  }
}

export const codeColorsFeature: Feature = {
  id: "code-colors",
  name: "Code Color Swatches",
  description: "Adds color swatches next to color definitions in code.",
  tags: ["ui", "code", "productivity"],
  pageTypes: ["repo", "code"],
  isEnabledByDefault: true,

  init() {
    injectStyles(`
      .ghcc-block { width:14px; height:14px; display:inline-block; vertical-align:middle;
        margin-right:4px; border-radius:4px; border:1px solid rgba(119,119,119,0.5); }
    `, 'code-colors');
    observeAndProcess([".highlight", ".react-code-text"], processCodeColors);
  }
};
