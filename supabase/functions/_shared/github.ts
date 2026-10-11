import { dateISO, textOnly } from "./content.ts";
import { canonicalLink } from "../../../lib/links.ts";

export function isPrerelease(value: { prerelease?: boolean; tag_name?: string }) {
  return value.prerelease === true || /(?:^|[\d._-])(?:alpha|beta|rc|preview|pre|dev|nightly|canary)(?:[._-]?\d+)?(?:[._+-]|$)/i.test(String(value.tag_name || ""));
}

/** Parse documented GitHub API objects. PR creation is not a software release or a merge. */
export function githubItems(
  value: unknown,
  source: { url: string; name: string; topic: string; id?: string; include_prereleases?: boolean; priority?: string },
  now = Date.now(),
) {
  const endpoint = new URL(source.url);
  if (endpoint.hostname !== "api.github.com")
    throw new Error("Use a GitHub API URL for a GitHub source");
  const releases = /\/releases(?:\/tags\/[^/]+)?$/.test(endpoint.pathname);
  const issue = /\/(issues|pulls)\/\d+$/.test(endpoint.pathname);
  if (!releases && !issue)
    throw new Error(
      "Supported GitHub sources: release lists, release tags, individual issues or pull requests",
    );
  const values = Array.isArray(value) ? value : [value];
  return values.slice(0, 100).flatMap((x: any) => {
    if (
      !x ||
      typeof x.html_url !== "string" ||
      x.draft ||
      (releases && isPrerelease(x) && !source.include_prereleases)
    )
      return [];
    let url: string;
    try {
      url = canonicalLink(x.html_url);
      if (new URL(url).hostname !== "github.com") return [];
    } catch {
      return [];
    }
    const published_at = dateISO(releases ? x.published_at : x.created_at);
    const updated_at = dateISO(x.updated_at);
    if (
      !published_at ||
      Date.parse(published_at) > now ||
      (releases && Date.parse(published_at) < now - 90 * 86400000)
    )
      return [];
    const kind = releases
      ? "Release"
      : endpoint.pathname.includes("/pulls/") || x.pull_request
        ? "Pull request"
        : "Issue";
    const state = kind === "Pull request" && x.merged_at ? "merged" : x.state;
    const body = textOnly(String(x.body || ""));
    const summary =
      (releases
        ? ""
        : `Status: ${["open", "closed", "merged"].includes(state) ? state : "unknown"}. `) +
      body;
    return [
      {
        url,
        title:
          source.name.replace(/ releases$/, "") +
          " · " +
          String(releases ? x.name || x.tag_name : x.title || "Update"),
        public_title: String(releases ? x.name || x.tag_name : x.title || "Update"),
        source: source.name.replace(/ releases$/, ""),
        topic: source.topic,
        kind,
        author: String(x.author?.login || x.user?.login || ""),
        published_at,
        updated_at:
          updated_at && Date.parse(updated_at) <= now ? updated_at : null,
        summary: summary.slice(0, 600),
        text: summary.slice(0, 12000),
        priority: source.priority,
        reference_meta: {
          origin: source.id ? "source_watch" : "github",
          source_id: source.id,
          repository: endpoint.pathname.split("/").slice(2, 4).join("/"),
          ...(releases ? { alert_kind: source.id ? "release" : undefined, tag: String(x.tag_name || "").slice(0,120), prerelease: isPrerelease(x) } : {}),
        },
      },
    ];
  });
}

export function githubAPIForLink(input: string): string | null {
  const url = new URL(input);
  if (url.hostname !== "github.com") return null;
  const match = url.pathname.match(
    /^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)$/,
  );
  if (match)
    return `https://api.github.com/repos/${match[1]}/${match[2]}/${match[3] === "pull" ? "pulls" : "issues"}/${match[4]}`;
  const release = url.pathname.match(
    /^\/([^/]+)\/([^/]+)\/releases\/tag\/(.+)$/,
  );
  return release
    ? `https://api.github.com/repos/${release[1]}/${release[2]}/releases/tags/${release[3]}`
    : null;
}
