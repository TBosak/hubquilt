import type { Feature } from "../core/feature-types";

export const apiLimit: Feature = {
  id: "sample-api-rate-limit-indicator",
  name: "GitHub API rate limit indicator",
  description:
    "Shows your GitHub API core rate limit remaining at the bottom of the page.",
  tags: ["api", "debug"],
  pageTypes: ["repo","code","issue","pull","pull-list","issue-list","notifications","profile","unknown"],
  isEnabledByDefault: false,
  requiresPAT: true,

  async init(ctx, settings = {}) {
    const { document, githubApi } = ctx;

    // Check if already added to prevent duplicates
    const existingIndicator = document.querySelector('[data-gh-enh-rate-limit]');
    if (existingIndicator) {
      existingIndicator.remove();
    }

    const hasToken = await githubApi.hasToken();
    if (!hasToken) {
      // Optional: show subtle hint that no token is set
      return;
    }

    let limit;
    try {
      limit = await githubApi.getRateLimit();
    } catch (err) {
      console.warn("[GHES] Failed to fetch rate limit", err);
      return;
    }
    if (!limit) return;

    const headerActions = document.querySelector<HTMLElement>(
      "div.pagehead-actions, div[role='banner']",
    ) || document.body;

    const container = document.createElement("div");
    container.setAttribute('data-gh-enh-rate-limit', 'true');
    container.style.fontSize = "12px";
    container.style.opacity = "0.7";
    container.style.marginTop = "4px";

    const remaining = limit.remaining;
    const resetDate = new Date(limit.reset * 1000);

    container.textContent = `GitHub API remaining: ${remaining} (resets at ${resetDate.toLocaleTimeString()})`;

    headerActions.appendChild(container);
  },
};
