import { canonicalLink } from "./links.ts";

/** Public repository URLs are converted to the documented release-list endpoint. */
export function githubWatchURL(input: string): string {
  const url = new URL(canonicalLink(input));
  const part = "[A-Za-z0-9_.-]+";
  if (url.hostname === "github.com") {
    const match = url.pathname.match(new RegExp(`^/(${part})/(${part})(?:/releases)?/?$`));
    if (match) return `https://api.github.com/repos/${match[1]}/${match[2].replace(/\.git$/, "")}/releases`;
  }
  if (url.hostname === "api.github.com" &&
      new RegExp(`^/repos/${part}/${part}/(?:releases(?:/tags/[^/]+)?|(?:issues|pulls)/[0-9]+)$`).test(url.pathname)) {
    url.search = "";
    return url.toString();
  }
  throw new Error("Use a public GitHub repository URL, releases URL, or a supported GitHub API watch.");
}

export const DEFAULT_REPO_QUERIES = [
  "llm inference serving",
  "gpu kubernetes operator",
  "rdma networking",
  "kv cache offloading",
  "llm gateway observability",
  "bare metal provisioning",
  "gpu topology scheduling",
  "inference benchmark optimization",
];

export function repositorySearchURL(query: string, now = Date.now()) {
  const q = query.trim();
  if (!q || q.length > 160 || /[\r\n\x00-\x1f]/.test(q))
    throw new Error("Repository queries must contain 1–160 characters.");
  const since = new Date(now - 30 * 86400000).toISOString().slice(0, 10);
  const u = new URL("https://api.github.com/search/repositories");
  u.searchParams.set("q", `${q} archived:false fork:false pushed:>=${since}`);
  // Alternate popularity and recency so established projects do not monopolize discovery.
  u.searchParams.set("sort", Math.floor(now / 86400000) % 2 ? "updated" : "stars");
  u.searchParams.set("order", "desc");
  u.searchParams.set("per_page", "6");
  return u.toString();
}
