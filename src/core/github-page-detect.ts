import type { PageType, RepoInfo } from "./feature-types";

export function detectRepoFromLocation(location: Location): RepoInfo | null {
  const parts = location.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, name] = parts;
  if (!owner || !name) return null;
  return { owner, name };
}

export function detectPageType(document: Document, location: Location): PageType {
  const { pathname } = location;
  const parts = pathname.split("/").filter(Boolean);

  if (pathname.startsWith("/notifications")) {
    return "notifications";
  }

  if (parts.length === 1) {
    const first = parts[0];
    if (!["settings", "orgs", "organizations", "marketplace"].includes(first)) {
      return "profile";
    }
  }

  const repo = detectRepoFromLocation(location);
  if (!repo) return "unknown";

  if (parts.length === 2) {
    return "repo";
  }

  const [, , section, maybeId] = parts;

  if (section === "issues" && maybeId) return "issue";
  if (section === "issues") return "issue-list";

  if (section === "pull" && maybeId) return "pull";
  if (section === "pulls") return "pull-list";

  if (section === "blob" || section === "tree") {
    return "code";
  }

  return "repo";
}
