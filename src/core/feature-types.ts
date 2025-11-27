export type PageType =
  | "repo"
  | "code"
  | "issue"
  | "pull"
  | "pull-list"
  | "issue-list"
  | "notifications"
  | "profile"
  | "unknown";

export interface RepoInfo {
  owner: string;
  name: string;
}

export interface FeatureContext {
  document: Document;
  location: Location;
  pageType: PageType;
  repo: RepoInfo | null;
  rootElement: HTMLElement | Document;
  storage: {
    get<T>(key: string, fallback: T): Promise<T>;
    set<T>(key: string, value: T): Promise<void>;
  };
  // Optional GitHub API client (with or without PAT)
  githubApi: {
    hasToken: () => Promise<boolean>;
    getRateLimit: () => Promise<{ remaining: number; reset: number } | null>;
    getJson<T>(path: string, params?: Record<string, string | number>): Promise<T>;
  };
}

export type FeatureOptionType = "text" | "number" | "boolean" | "select" | "color";

export interface FeatureOption {
  key: string;
  label: string;
  description?: string;
  type: FeatureOptionType;
  defaultValue: any;
  options?: { value: any; label: string }[]; // For select type
  min?: number; // For number type
  max?: number; // For number type
}

export interface FeatureMeta {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  pageTypes: PageType[];
  isEnabledByDefault: boolean;
  requiresPAT?: boolean;
  options?: FeatureOption[];
}

export interface Feature extends FeatureMeta {
  init(ctx: FeatureContext, settings?: Record<string, any>): void | Promise<void>;
}
