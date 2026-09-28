import type { Article, Folder } from "./domain.ts";
import { basicRelevance } from "./domain.ts";
import { TEAM_FOLDERS, TEAM_PROFILE } from "./coverage.ts";
import { canonicalLink } from "./links.ts";
import {
  TEAM_LINK_ROWS,
  SHARED_ALIASES,
  CHECKED_LINKS,
} from "../data/team-links.ts";

export const IMPORT_KEY = "team-links-2026-09";
const importedAt = "2026-09-28T00:00:00.000Z";
const checked = new Set(CHECKED_LINKS.map(canonicalLink));
export const STARTER_FOLDERS: Folder[] = TEAM_FOLDERS.map(
  ([id, name, parent_id]) => ({ id, name, parent_id }),
);

export function buildTeamLibrary(): Article[] {
  const unique = new Map<string, Article>();
  for (const [folderKey, kind, title, original, candidate] of TEAM_LINK_ROWS) {
    const url = canonicalLink(candidate || original);
    const existing = unique.get(url);
    if (existing) {
      existing.reference_meta!.original_urls = [
        ...new Set([...existing.reference_meta!.original_urls!, original]),
      ];
      existing.folder_ids = [
        ...new Set([...(existing.folder_ids || []), folderKey]),
      ];
      continue;
    }
    const folder = TEAM_FOLDERS.find(([key]) => key === folderKey);
    if (!folder) throw new Error("Unknown team folder: " + folderKey);
    const unresolved = new URL(url).hostname === "share.google";
    const relevance = basicRelevance(
      title + " " + url,
      TEAM_PROFILE.priorities,
    );
    const note = candidate
      ? "A primary-source page was matched by title. The Google redirect could not be verified; keep the original share for comparison."
      : unresolved
        ? "The original Google short link is preserved. Its destination and publication date have not been resolved."
        : "Imported from the team's public reading list. The label describes the topic; technical claims and compatibility still need review.";
    unique.set(url, {
      id: "team-" + String(unique.size + 1).padStart(3, "0"),
      url,
      title,
      source: new URL(url).hostname.replace(/^www\./, ""),
      kind,
      topic: folder[3],
      tags: relevance.tags,
      summary: `${kind} saved for ${folder[1].toLowerCase()}. ${unresolved ? "Original short link needs review." : "Open the source for version details and evidence."}`,
      reason:
        "Selected by your team for " +
        folder[1].toLowerCase() +
        ". " +
        relevance.reason,
      score: relevance.score,
      analysis_status: "reference",
      published_at: null,
      discovered_at: importedAt,
      saved: true,
      folder_ids: [folderKey],
      reference_meta: {
        origin: IMPORT_KEY,
        original_urls: [original],
        link_status: candidate
          ? "title-match"
          : unresolved
            ? "unresolved"
            : checked.has(url)
              ? "checked"
              : "submitted",
        checked_at: checked.has(url) ? importedAt : undefined,
        note,
      },
    });
  }
  for (const alias of SHARED_ALIASES) {
    const article = unique.get(canonicalLink(alias));
    if (article)
      article.reference_meta!.original_urls = [
        ...new Set([...article.reference_meta!.original_urls!, alias]),
      ];
  }
  return [...unique.values()];
}

export const TEAM_ARTICLES = buildTeamLibrary();
export const IMPORT_STATS = {
  links: TEAM_ARTICLES.length,
  folders: STARTER_FOLDERS.length,
  unresolved: TEAM_ARTICLES.filter(
    (a) => a.reference_meta?.link_status === "unresolved",
  ).length,
  titleMatches: TEAM_ARTICLES.filter(
    (a) => a.reference_meta?.link_status === "title-match",
  ).length,
};
