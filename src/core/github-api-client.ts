// Browser compatibility: Use browser or chrome API
const storageApi = typeof browser !== "undefined" ? browser.storage : chrome.storage;

const PAT_STORAGE_KEY = "githubPat";

async function getPat(): Promise<string | null> {
  const raw = await storageApi.local.get(PAT_STORAGE_KEY);
  return (raw && raw[PAT_STORAGE_KEY] as string | undefined) ?? null;
}

export interface GithubApiClient {
  hasToken: () => Promise<boolean>;
  getRateLimit: () => Promise<{ remaining: number; reset: number } | null>;
  getJson<T>(path: string, params?: Record<string, string | number>): Promise<T>;
}

function buildUrl(path: string, params?: Record<string, string | number>): string {
  const base = "https://api.github.com";
  const url = new URL(path.startsWith("/") ? path : `/${path}`, base);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export function createGithubApiClient(): GithubApiClient {
  return {
    async hasToken() {
      const pat = await getPat();
      return !!pat;
    },

    async getRateLimit() {
      try {
        const res = await this.getJson<{ resources?: { core?: { remaining: number; reset: number } } }>(
          "/rate_limit",
        );
        const core = res.resources?.core;
        if (!core) return null;
        return { remaining: core.remaining, reset: core.reset };
      } catch {
        return null;
      }
    },

    async getJson<T>(path: string, params?: Record<string, string | number>): Promise<T> {
      const pat = await getPat();
      const url = buildUrl(path, params);
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
      };
      if (pat) {
        headers.Authorization = `Bearer ${pat}`;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`GitHub API error ${res.status}: ${res.statusText}`);
      }
      return (await res.json()) as T;
    },
  };
}
