import type { Feature, FeatureContext } from "./feature-types";
import { detectPageType, detectRepoFromLocation } from "./github-page-detect";
import { createGithubApiClient } from "./github-api-client";

// Import features
import { apiLimit } from "../features/api-limit";
import { codeColorsFeature } from "../features/code-colors";
import { collapseMarkdownFeature } from "../features/collapse-markdown";
import { collapseInCommentFeature } from "../features/collapse-in-comment";
import { labelColorPickerFeature } from "../features/label-color-picker";
import { moduleLinkerFeature } from "../features/module-linker";
import { gifsForCommentsFeature } from "../features/gifs-for-comments";
import { fileIconsFeature } from "../features/file-icons";
import { fileDownloadsFeature } from "../features/file-downloads";

const ALL_FEATURES: Feature[] = [
  apiLimit,
  codeColorsFeature,
  collapseMarkdownFeature,
  collapseInCommentFeature,
  labelColorPickerFeature,
  moduleLinkerFeature,
  gifsForCommentsFeature,
  fileIconsFeature,
  fileDownloadsFeature,
];

type FeatureSettings = {
  [featureId: string]: boolean;
};

type FeatureOptionsMap = {
  [featureId: string]: Record<string, any>;
};

const FEATURE_SETTINGS_KEY = "featureSettings";
const FEATURE_OPTIONS_KEY = "featureOptions";

async function getFeatureSettings(): Promise<FeatureSettings> {
  const raw = await chrome.storage.sync.get(FEATURE_SETTINGS_KEY);
  return (raw[FEATURE_SETTINGS_KEY] as FeatureSettings | undefined) ?? {};
}

async function setFeatureSettings(settings: FeatureSettings): Promise<void> {
  await chrome.storage.sync.set({ [FEATURE_SETTINGS_KEY]: settings });
}

async function getFeatureOptions(): Promise<FeatureOptionsMap> {
  const raw = await chrome.storage.sync.get(FEATURE_OPTIONS_KEY);
  return (raw[FEATURE_OPTIONS_KEY] as FeatureOptionsMap | undefined) ?? {};
}

async function setFeatureOptions(options: FeatureOptionsMap): Promise<void> {
  await chrome.storage.sync.set({ [FEATURE_OPTIONS_KEY]: options });
}

function createStorage(prefix: string) {
  const makeKey = (key: string) => `${prefix}:${key}`;
  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const fullKey = makeKey(key);
      const raw = await chrome.storage.sync.get(fullKey);
      return (raw[fullKey] as T | undefined) ?? fallback;
    },
    async set<T>(key: string, value: T): Promise<void> {
      const fullKey = makeKey(key);
      await chrome.storage.sync.set({ [fullKey]: value });
    },
  };
}

function getFeatureOptionsWithDefaults(feature: Feature, savedOptions: FeatureOptionsMap): Record<string, any> {
  const defaults: Record<string, any> = {};

  if (feature.options) {
    for (const option of feature.options) {
      defaults[option.key] = option.defaultValue;
    }
  }

  return {
    ...defaults,
    ...(savedOptions[feature.id] ?? {}),
  };
}

export async function bootstrapFeatures(document: Document, location: Location): Promise<void> {
  const pageType = detectPageType(document, location);
  const repo = detectRepoFromLocation(location);
  const featureSettings = await getFeatureSettings();
  const featureOptions = await getFeatureOptions();
  const githubApi = createGithubApiClient();
  const hasPAT = await githubApi.hasToken();

  const ctx: FeatureContext = {
    document,
    location,
    pageType,
    repo,
    rootElement: document,
    storage: createStorage("gh-enh-suite"),
    githubApi,
  };

  for (const feature of ALL_FEATURES) {
    if (!feature.pageTypes.includes(pageType)) continue;

    const enabled =
      featureSettings[feature.id] ??
      feature.isEnabledByDefault;

    if (!enabled) continue;

    // Skip features that require PAT if no PAT is configured
    if (feature.requiresPAT && !hasPAT) {
      console.warn(`[HubQuilt] Feature "${feature.name}" requires a GitHub PAT but none is configured. Skipping.`);
      continue;
    }

    try {
      const settings = getFeatureOptionsWithDefaults(feature, featureOptions);
      await feature.init(ctx, settings);
    } catch (err) {
      console.error(`[HubQuilt] Feature "${feature.id}" failed:`, err);
    }
  }
}

export function listAllFeatures(): Feature[] {
  return ALL_FEATURES;
}

export async function getFeatureEnabledStates(): Promise<FeatureSettings> {
  const settings = await getFeatureSettings();
  const result: FeatureSettings = {};
  for (const f of ALL_FEATURES) {
    result[f.id] = settings[f.id] ?? f.isEnabledByDefault;
  }
  return result;
}

export async function updateFeatureEnabled(id: string, enabled: boolean): Promise<void> {
  const settings = await getFeatureSettings();
  settings[id] = enabled;
  await setFeatureSettings(settings);
}

export async function getFeatureOptionValues(featureId: string): Promise<Record<string, any>> {
  const allOptions = await getFeatureOptions();
  const feature = ALL_FEATURES.find((f) => f.id === featureId);

  if (!feature) {
    return {};
  }

  return getFeatureOptionsWithDefaults(feature, allOptions);
}

export async function updateFeatureOption(
  featureId: string,
  optionKey: string,
  value: any
): Promise<void> {
  const allOptions = await getFeatureOptions();

  if (!allOptions[featureId]) {
    allOptions[featureId] = {};
  }

  allOptions[featureId][optionKey] = value;
  await setFeatureOptions(allOptions);
}
