import {
  listAllFeatures,
  getFeatureEnabledStates,
  updateFeatureEnabled,
  getFeatureOptionValues,
  updateFeatureOption,
} from "../core/feature-registry";
import type { Feature, FeatureOption } from "../core/feature-types";

const PAT_STORAGE_KEY = "githubPat";
const THEME_STORAGE_KEY = "themePreference";

type Theme = "light" | "dark" | "auto";

async function loadPat(): Promise<string | null> {
  const raw = await chrome.storage.local.get(PAT_STORAGE_KEY);
  return (raw[PAT_STORAGE_KEY] as string | undefined) ?? null;
}

async function savePat(pat: string | null): Promise<void> {
  if (pat && pat.trim().length > 0) {
    await chrome.storage.local.set({ [PAT_STORAGE_KEY]: pat.trim() });
  } else {
    await chrome.storage.local.remove(PAT_STORAGE_KEY);
  }
}

async function loadTheme(): Promise<Theme> {
  const raw = await chrome.storage.local.get(THEME_STORAGE_KEY);
  return (raw[THEME_STORAGE_KEY] as Theme | undefined) ?? "auto";
}

async function saveTheme(theme: Theme): Promise<void> {
  await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
}

function applyTheme(theme: Theme) {
  const body = document.body;
  const themeIcon = document.getElementById("theme-icon");
  const themeToggle = document.getElementById("theme-toggle");

  // Remove any existing theme attribute
  body.removeAttribute("data-theme");

  if (themeIcon) {
    // Remove all possible icon classes
    themeIcon.className = "";
    themeIcon.classList.add("fa-solid");
  }

  if (theme === "light") {
    body.setAttribute("data-theme", "light");
    if (themeIcon) themeIcon.classList.add("fa-sun");
    if (themeToggle) themeToggle.title = "Switch to dark mode";
  } else if (theme === "dark") {
    body.setAttribute("data-theme", "dark");
    if (themeIcon) themeIcon.classList.add("fa-moon");
    if (themeToggle) themeToggle.title = "Switch to auto mode";
  } else {
    // auto - use system preference
    if (themeIcon) themeIcon.classList.add("fa-circle-half-stroke");
    if (themeToggle) themeToggle.title = "Switch to light mode";
  }
}

async function initTheme() {
  const currentTheme = await loadTheme();
  applyTheme(currentTheme);

  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", async () => {
      const currentTheme = await loadTheme();

      // Cycle through: auto -> light -> dark -> auto
      let newTheme: Theme;
      if (currentTheme === "auto") {
        newTheme = "light";
      } else if (currentTheme === "light") {
        newTheme = "dark";
      } else {
        newTheme = "auto";
      }

      await saveTheme(newTheme);
      applyTheme(newTheme);
    });
  }
}

function createOptionInput(
  feature: Feature,
  option: FeatureOption,
  currentValue: any
): HTMLElement {
  const optionRow = document.createElement("div");
  optionRow.className = "option-row";

  const label = document.createElement("label");
  label.className = "option-label";
  label.textContent = option.label;
  if (option.description) {
    label.title = option.description;
  }

  let input: HTMLInputElement | HTMLSelectElement;

  if (option.type === "boolean") {
    const checkboxInput = document.createElement("input");
    checkboxInput.type = "checkbox";
    checkboxInput.checked = currentValue ?? option.defaultValue;
    checkboxInput.addEventListener("change", async () => {
      await updateFeatureOption(feature.id, option.key, checkboxInput.checked);
    });
    input = checkboxInput;
  } else if (option.type === "number") {
    const numberInput = document.createElement("input");
    numberInput.type = "number";
    numberInput.value = String(currentValue ?? option.defaultValue);
    if (option.min !== undefined) numberInput.min = String(option.min);
    if (option.max !== undefined) numberInput.max = String(option.max);
    numberInput.step = "0.1";
    numberInput.addEventListener("change", async () => {
      await updateFeatureOption(feature.id, option.key, parseFloat(numberInput.value));
    });
    input = numberInput;
  } else if (option.type === "select") {
    input = document.createElement("select");
    option.options?.forEach((opt) => {
      const optEl = document.createElement("option");
      optEl.value = String(opt.value);
      optEl.textContent = opt.label;
      input.appendChild(optEl);
    });
    input.value = String(currentValue ?? option.defaultValue);
    input.addEventListener("change", async () => {
      await updateFeatureOption(feature.id, option.key, input.value);
    });
  } else if (option.type === "color") {
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = currentValue ?? option.defaultValue;
    colorInput.addEventListener("change", async () => {
      await updateFeatureOption(feature.id, option.key, colorInput.value);
    });
    input = colorInput;
  } else {
    // text type
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = currentValue ?? option.defaultValue;
    textInput.addEventListener("change", async () => {
      await updateFeatureOption(feature.id, option.key, textInput.value);
    });
    input = textInput;
  }

  input.className = "option-input";

  optionRow.appendChild(label);
  optionRow.appendChild(input);

  return optionRow;
}

// Filter state
let searchQuery = "";
let activePageFilters = new Set<string>();
let activeTagFilters = new Set<string>();

function matchesFilters(feature: Feature): boolean {
  // Search query filter
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    const nameMatch = feature.name.toLowerCase().includes(query);
    const descMatch = feature.description.toLowerCase().includes(query);
    const idMatch = feature.id.toLowerCase().includes(query);
    const tagMatch = feature.tags?.some(tag => tag.toLowerCase().includes(query));

    if (!nameMatch && !descMatch && !idMatch && !tagMatch) {
      return false;
    }
  }

  // Page type filters
  if (activePageFilters.size > 0) {
    const hasMatchingPage = feature.pageTypes.some(page => activePageFilters.has(page));
    if (!hasMatchingPage) {
      return false;
    }
  }

  // Tag filters
  if (activeTagFilters.size > 0) {
    const hasMatchingTag = feature.tags?.some(tag => activeTagFilters.has(tag));
    if (!hasMatchingTag) {
      return false;
    }
  }

  return true;
}

function applyFilters() {
  const featureItems = document.querySelectorAll(".feature-item");
  const features = listAllFeatures();

  featureItems.forEach((item, index) => {
    const feature = features[index];
    if (feature && matchesFilters(feature)) {
      item.classList.remove("hidden");
    } else {
      item.classList.add("hidden");
    }
  });
}

function setupFilterChips() {
  const features = listAllFeatures();

  // Collect all unique page types and tags
  const allPageTypes = new Set<string>();
  const allTags = new Set<string>();

  features.forEach(feature => {
    feature.pageTypes.forEach(page => allPageTypes.add(page));
    feature.tags?.forEach(tag => allTags.add(tag));
  });

  // Render page filter chips
  const pageFiltersContainer = document.getElementById("page-filters");
  if (pageFiltersContainer) {
    pageFiltersContainer.innerHTML = "";
    Array.from(allPageTypes).sort().forEach(pageType => {
      const chip = document.createElement("span");
      chip.className = "filter-chip";
      chip.textContent = pageType;
      chip.dataset.filter = pageType;

      chip.addEventListener("click", () => {
        if (activePageFilters.has(pageType)) {
          activePageFilters.delete(pageType);
          chip.classList.remove("active");
        } else {
          activePageFilters.add(pageType);
          chip.classList.add("active");
        }
        applyFilters();
      });

      pageFiltersContainer.appendChild(chip);
    });
  }

  // Render tag filter chips
  const tagFiltersContainer = document.getElementById("tag-filters");
  if (tagFiltersContainer) {
    tagFiltersContainer.innerHTML = "";
    Array.from(allTags).sort().forEach(tag => {
      const chip = document.createElement("span");
      chip.className = "filter-chip";
      chip.textContent = tag;
      chip.dataset.filter = tag;

      chip.addEventListener("click", () => {
        if (activeTagFilters.has(tag)) {
          activeTagFilters.delete(tag);
          chip.classList.remove("active");
        } else {
          activeTagFilters.add(tag);
          chip.classList.add("active");
        }
        applyFilters();
      });

      tagFiltersContainer.appendChild(chip);
    });
  }
}

function setupSearch() {
  const searchInput = document.getElementById("feature-search") as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value.trim();
      applyFilters();
    });
  }
}

async function renderFeatures() {
  const container = document.getElementById("feature-list");
  if (!container) return;

  const features = listAllFeatures();
  const states = await getFeatureEnabledStates();
  const hasPAT = await loadPat();

  container.innerHTML = "";

  for (const feature of features) {
    const item = document.createElement("div");
    item.className = "feature-item";

    const header = document.createElement("div");
    header.className = "feature-header";

    // Feature info section with collapse indicator
    const info = document.createElement("div");
    info.className = "feature-info";

    const nameContainer = document.createElement("div");
    nameContainer.style.display = "flex";
    nameContainer.style.alignItems = "center";
    nameContainer.style.gap = "8px";

    // Collapse indicator (only show if feature has options)
    let collapseIndicator: HTMLSpanElement | null = null;
    if (feature.options && feature.options.length > 0) {
      collapseIndicator = document.createElement("span");
      collapseIndicator.className = "collapse-indicator";
      collapseIndicator.textContent = "▶";
      nameContainer.appendChild(collapseIndicator);
    }

    const name = document.createElement("h3");
    name.className = "feature-name";
    name.textContent = feature.name;
    nameContainer.appendChild(name);

    // Add PAT required badge if feature requires PAT
    if (feature.requiresPAT) {
      const patBadge = document.createElement("span");
      patBadge.className = "tag";
      patBadge.textContent = "Requires PAT";
      patBadge.style.backgroundColor = "var(--color-attention-bg)";
      patBadge.style.borderColor = "var(--color-attention-border)";
      patBadge.style.color = "var(--color-attention-fg)";
      nameContainer.appendChild(patBadge);
    }

    info.appendChild(nameContainer);

    let desc = document.createElement("p");
    desc.className = "feature-description";
    desc.textContent = feature.description;

    // Add warning if feature requires PAT but none is set
    if (feature.requiresPAT && !hasPAT) {
      desc.textContent += " ⚠️ This feature is disabled because no GitHub PAT is configured.";
      desc.style.color = "var(--color-attention-fg)";
    }

    info.appendChild(desc);

    // Tags
    const tagsContainer = document.createElement("div");
    tagsContainer.className = "feature-tags";

    const allTags = [
      feature.id,
      ...(feature.tags ?? []),
      ...feature.pageTypes.map((p) => `page:${p}`),
    ];

    allTags.forEach((tagText) => {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = tagText;
      tagsContainer.appendChild(tag);
    });

    info.appendChild(tagsContainer);
    header.appendChild(info);

    // Toggle switch wrapper
    const toggleWrapper = document.createElement("div");
    toggleWrapper.className = "feature-toggle-wrapper";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle-switch";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = states[feature.id];

    // Disable toggle if feature requires PAT and none is set
    if (feature.requiresPAT && !hasPAT) {
      toggle.disabled = true;
      toggle.checked = false;
      toggleLabel.style.opacity = "0.5";
      toggleLabel.style.cursor = "not-allowed";
      toggleLabel.title = "This feature requires a GitHub Personal Access Token (PAT). Please configure one above.";
    }

    toggle.addEventListener("change", async (e) => {
      e.stopPropagation(); // Prevent header click from triggering
      if (!toggle.disabled) {
        await updateFeatureEnabled(feature.id, toggle.checked);
      }
    });

    const slider = document.createElement("span");
    slider.className = "toggle-slider";

    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(slider);
    toggleWrapper.appendChild(toggleLabel);
    header.appendChild(toggleWrapper);

    item.appendChild(header);

    // Add options if feature has any
    if (feature.options && feature.options.length > 0) {
      const optionsContainer = document.createElement("div");
      optionsContainer.className = "feature-options collapsed";

      const optionsTitle = document.createElement("div");
      optionsTitle.className = "options-title";
      optionsTitle.textContent = "Configuration";
      optionsContainer.appendChild(optionsTitle);

      const currentValues = await getFeatureOptionValues(feature.id);

      for (const option of feature.options) {
        const optionInput = createOptionInput(feature, option, currentValues[option.key]);
        optionsContainer.appendChild(optionInput);
      }

      item.appendChild(optionsContainer);

      // Add click handler to header for collapsing/expanding
      header.addEventListener("click", (e) => {
        // Don't toggle if clicking on the toggle switch itself
        if ((e.target as HTMLElement).closest(".toggle-switch")) {
          return;
        }

        const isExpanded = optionsContainer.classList.contains("expanded");

        if (isExpanded) {
          optionsContainer.classList.remove("expanded");
          optionsContainer.classList.add("collapsed");
          if (collapseIndicator) {
            collapseIndicator.classList.remove("expanded");
          }
        } else {
          optionsContainer.classList.remove("collapsed");
          optionsContainer.classList.add("expanded");
          if (collapseIndicator) {
            collapseIndicator.classList.add("expanded");
          }
        }
      });
    }

    container.appendChild(item);
  }
}

function showFlash(container: HTMLElement, message: string, type: "success" | "warn") {
  container.innerHTML = "";
  const flash = document.createElement("div");
  flash.className = `flash flash-${type}`;
  flash.textContent = message;
  container.appendChild(flash);
}

async function initPatSection() {
  const patInput = document.getElementById("pat-input") as HTMLInputElement | null;
  const patSaveBtn = document.getElementById("pat-save-btn") as HTMLButtonElement | null;
  const patClearBtn = document.getElementById("pat-clear-btn") as HTMLButtonElement | null;
  const patStatus = document.getElementById("pat-status") as HTMLDivElement | null;

  if (!patInput || !patSaveBtn || !patClearBtn || !patStatus) return;

  const existing = await loadPat();
  patInput.value = existing ? "********" : "";

  if (existing) {
    showFlash(patStatus, "Token is configured. Advanced features are enabled.", "success");
  } else {
    showFlash(patStatus, "No token set. Some features may be limited.", "warn");
  }

  patSaveBtn.addEventListener("click", async () => {
    const value = patInput.value.trim();
    await savePat(value);

    if (value && value !== "********") {
      showFlash(patStatus, "Token saved successfully. Advanced features are now enabled.", "success");
      patInput.value = "********";
      // Re-render features to update PAT-required toggles
      await renderFeatures();
    } else if (value === "********") {
      showFlash(patStatus, "Token already set. Enter a new token to update.", "warn");
    } else {
      showFlash(patStatus, "Token cleared.", "warn");
    }
  });

  patClearBtn.addEventListener("click", async () => {
    await savePat(null);
    patInput.value = "";
    showFlash(patStatus, "Token cleared. Some features may be limited.", "warn");
    // Re-render features to disable PAT-required toggles
    await renderFeatures();
  });
}

async function main() {
  await initTheme();
  await initPatSection();
  await renderFeatures();
  setupFilterChips();
  setupSearch();
}

main().catch((err) => console.error("[GitHub Enhancement Suite] options render failed", err));
