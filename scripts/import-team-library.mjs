#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  TEAM_ARTICLES,
  IMPORT_KEY,
  IMPORT_STATS,
} from "../lib/team-library.ts";
import { TEAM_FOLDERS, TEAM_PROFILE, TEAM_SOURCES } from "../lib/coverage.ts";
import { safeURL } from "../supabase/functions/_shared/content.ts";

export function teamImportPayload() {
  return {
    key: IMPORT_KEY,
    profile: TEAM_PROFILE,
    folders: TEAM_FOLDERS.map(([key, name, parent_key]) => ({
      key,
      name,
      parent_key,
    })),
    sources: TEAM_SOURCES,
    articles: TEAM_ARTICLES.map((a) => {
      let queue_metadata = false;
      try {
        safeURL(a.url);
        queue_metadata = !["PDF", "Video", "Playlist"].includes(a.kind);
      } catch {
        /* Keep the original without fetching unapproved hosts. */
      }
      return {
        url: a.url,
        title: a.title,
        source: a.source,
        kind: a.kind,
        topic: a.topic,
        tags: a.tags,
        summary: a.summary,
        reason: a.reason,
        score: a.score,
        reference_meta: a.reference_meta,
        folder_key: a.folder_ids[0],
        queue_metadata,
      };
    }),
  };
}

export async function importTeamLibrary(request) {
  return request("/rest/v1/rpc/ss_import_team", "POST", {
    payload: teamImportPayload(),
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes("--sql")) {
    // Dollar quoting is checked before writing. This SQL is data, not interpolated shell code.
    const data = JSON.stringify(teamImportPayload());
    const delimiter = "$stacksignal_import$";
    if (data.includes(delimiter))
      throw new Error("Unexpected SQL delimiter in input");
    writeFileSync(
      "supabase/seed-team.sql",
      `-- Run after both migrations and administrator creation. Safe to repeat.\nselect public.ss_import_team(${delimiter}${data}${delimiter}::jsonb);\n`,
    );
    console.log(
      `Prepared ${IMPORT_STATS.links} references, ${IMPORT_STATS.folders} folders and ${TEAM_SOURCES.length} source watches.`,
    );
  } else {
    if (existsSync(".env.setup")) process.loadEnvFile(".env.setup");
    const base = process.env.SUPABASE_URL,
      key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base || "") || !key)
      throw new Error(
        "Configure Supabase first; secrets belong in .env.setup.",
      );
    const result = await importTeamLibrary(async (path, method, body) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          apikey: key,
          Authorization: "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok)
        throw new Error(
          `Import failed (${response.status}); check migrations and administrator bootstrap.`,
        );
      return response.json();
    });
    console.log(JSON.stringify(result));
  }
}
