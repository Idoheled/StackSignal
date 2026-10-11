import { canonicalLink } from "../../../lib/links.ts";
import { TRUSTED_HOSTS, dateISO, textOnly } from "./content.ts";
import { relevance } from "./relevance.ts";

export function lowValueDiscovery(title: string, text: string, url = "") {
  return /\b(portfolio|curriculum vitae|my resume|personal website|job vacancy|we are hiring|stock price|share price|price target|coupon|giveaway)\b/i.test(title + " " + text.slice(0, 800)) ||
    /\/(?:careers|jobs|vacancies)(?:\/|$)/i.test(url);
}

export function webSearchRequest(query: string, lane: "recent" | "explore") {
  const q = query.trim();
  if (!q || q.length > 300 || /[\x00-\x1f]/.test(q)) throw new Error("Invalid public discovery query");
  return {
    query: q, search_depth: "basic", auto_parameters: false, topic: "general",
    ...(lane === "recent" ? { time_range: "week" } : {}), max_results: 8,
    include_published_date: true, filter_by_published_date: false,
    include_answer: false, include_raw_content: false, include_images: false,
    include_usage: true,
  };
}

/** Search snippets are evidence of a search result, never evidence of an actual destination fetch. */
export function webCandidate(result: any, profile: any, query: string, lane: string) {
  if (!result || typeof result.url !== "string" || result.url.length > 2000 ||
      typeof result.title !== "string" || typeof result.content !== "string") return null;
  let url: string;
  try { url = canonicalLink(result.url); } catch { return null; }
  const parsed = new URL(url);
  const title = textOnly(result.title).slice(0, 500).trim();
  const text = textOnly(result.content).slice(0, 4000).trim();
  if (!title || text.length < 60 || lowValueDiscovery(title, text, url)) return null;
  // A useful snippet must match the team's technical context, not just the search provider's query score.
  if (relevance(title, text, profile).score < 45 && !(lane === "explore" && text.length >= 120)) return null;
  const repository = parsed.hostname === "github.com" && parsed.pathname.match(/^\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/?$/)?.[1];
  return {
    title, url, text, summary: text.slice(0, 600), source: parsed.hostname,
    kind: repository ? "Repository" : "Discovery",
    published_at: dateISO(typeof result.published_date === "string" ? result.published_date : null),
    reference_meta: {
      origin: "discovery", discovery_lane: "web_search", search_provider: "Tavily",
      search_query: query.slice(0, 300), search_window: lane,
      source_tier: TRUSTED_HOSTS.includes(parsed.hostname) ? "known_publisher" : "open_web",
      date_basis: "search_provider", link_status: "search_result",
      ...(repository ? { repository } : {}),
      note: "Found by web search. Excerpt and any publication date are reported by the search provider; verify the original. Automatic extraction is restricted to approved hosts.",
    },
  };
}
