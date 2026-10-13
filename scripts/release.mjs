import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const repository = "Idoheled/StackSignal";

export function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error("Use a stable semantic version, for example 0.1.1.");
  return version.split(".").map(BigInt);
}

export function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function releaseNotes(version, changelog) {
  versionParts(version);
  const headings = [...changelog.matchAll(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\s*$/gm)];
  if (headings[0]?.[1] !== version || headings.filter(h => h[1] === version).length !== 1)
    throw new Error("The newest, unique versioned changelog entry must match package.json.");
  const heading = headings[0];
  const start = heading.index + heading[0].length;
  const end = changelog.indexOf("\n## ", start);
  const notes = changelog.slice(start, end < 0 ? undefined : end).trim();
  if (!/^[-*] \S/m.test(notes)) throw new Error("Release notes must contain a concrete change.");
  return notes;
}

export function prepareRelease(pkg, changelog, version, date = new Date().toISOString().slice(0, 10)) {
  if (compareVersions(version, pkg.version) <= 0) throw new Error("The new version must increase.");
  releaseNotes(pkg.version, changelog);
  if (changelog.includes(`## [${version}]`)) throw new Error("That version already has release notes.");
  const match = /^## \[Unreleased\]\s*\n([\s\S]*?)(?=\n## |$)/m.exec(changelog);
  if (!match || !/^[-*] \S/m.test(match[1])) throw new Error("Add concrete changes under [Unreleased] first.");
  const replacement = `## [Unreleased]\n\n## [${version}] - ${date}\n\n${match[1].trim()}\n`;
  const nextChangelog = changelog.slice(0, match.index) + replacement + changelog.slice(match.index + match[0].length);
  releaseNotes(version, nextChangelog);
  return { pkg: { ...pkg, version }, changelog: nextChangelog };
}

export async function publishRelease({ version, notes, env, request }) {
  versionParts(version);
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REPOSITORY !== repository ||
      env.GITHUB_REF !== "refs/heads/main" || !["push", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME) ||
      !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || "") ||
      env.QUALITY_RESULT !== "success" || env.PRODUCTION_RESULT !== "success")
    throw new Error("Publication requires successful Quality and Production jobs on this repository's main branch.");

  const tag = `v${version}`;
  let existing = await request(`/releases/tags/${tag}`, { allow404: true });
  if (existing && !existing.draft) {
    if (existing.prerelease) throw new Error("A stable version already exists as a prerelease.");
    return { state: "existing", url: existing.html_url, tag };
  }
  const head = await request("/git/ref/heads/main");
  if (head.object.sha !== env.GITHUB_SHA) return { state: "superseded", tag };
  // The by-tag endpoint returns published releases; drafts require the authenticated list.
  if (!existing) {
    for (let page = 1; ; page++) {
      if (page > 20) throw new Error("Release history exceeds the bounded draft lookup; inspect it before publishing.");
      const releases = await request(`/releases?per_page=100&page=${page}`);
      existing = releases.find(release => release.tag_name === tag);
      if (existing || releases.length < 100) break;
    }
    if (existing && !existing.draft) return { state: "existing", url: existing.html_url, tag };
  }
  const latest = await request("/releases/latest", { allow404: true });
  if (latest && compareVersions(version, latest.tag_name.replace(/^v/, "")) <= 0)
    throw new Error("A new stable release must be newer than the latest published release.");

  const ref = await request(`/git/ref/tags/${tag}`, { allow404: true });
  if (ref) {
    let object = ref.object;
    for (let depth = 0; object.type === "tag" && depth < 8; depth++)
      object = (await request(`/git/tags/${object.sha}`)).object;
    if (object.type !== "commit" || object.sha !== env.GITHUB_SHA)
      throw new Error("The existing release tag targets another commit; tags are never moved.");
  } else {
    await request("/git/refs", { method: "POST", body: { ref: `refs/tags/${tag}`, sha: env.GITHUB_SHA } });
  }
  // Recheck after creating the ref so a superseded deployment cannot become latest.
  if ((await request("/git/ref/heads/main")).object.sha !== env.GITHUB_SHA)
    return { state: "superseded", tag };
  const body = {
    tag_name: tag, target_commitish: env.GITHUB_SHA, name: `StackSignal ${tag}`,
    body: `${notes}\n\n---\nSource commit: ${env.GITHUB_SHA}\n\nValidation: https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID}\n\n[Release process](https://github.com/${repository}/blob/${tag}/docs/RELEASES.md) · [Deployment and rollback](https://github.com/${repository}/blob/${tag}/docs/DEPLOYMENT.md)`,
    draft: false, prerelease: false, make_latest: "true",
  };
  const release = existing
    ? await request(`/releases/${existing.id}`, { method: "PATCH", body })
    : await request("/releases", { method: "POST", body });
  return { state: "published", url: release.html_url, tag };
}

async function main() {
  const [command, version, ...extra] = process.argv.slice(2);
  if (extra.length || !["check", "prepare", "publish"].includes(command) || (command === "prepare") !== Boolean(version))
    throw new Error("Usage: node scripts/release.mjs check | prepare <version> | publish");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const notes = releaseNotes(pkg.version, changelog);
  if (command === "prepare") {
    const next = prepareRelease(pkg, changelog, version);
    writeFileSync("package.json", JSON.stringify(next.pkg, null, 2) + "\n");
    writeFileSync("CHANGELOG.md", next.changelog);
    console.log(`Prepared v${version}. Review and commit package.json and CHANGELOG.md; CI publishes after deployment succeeds.`);
    return;
  }
  if (command === "check") {
    console.log(`Validated v${pkg.version} and its changelog entry.`);
    return;
  }
  if (!process.env.GITHUB_TOKEN) throw new Error("The release job requires its ephemeral GITHUB_TOKEN.");
  async function request(path, { method = "GET", body, allow404 = false } = {}) {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      method, headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "error", signal: AbortSignal.timeout(30000),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${path} failed (${response.status}); rerun the failed release job.`);
    return response.json();
  }
  const result = await publishRelease({ version: pkg.version, notes, env: process.env, request });
  const summary = `${result.tag}: ${result.state}${result.url ? ` — ${result.url}` : ""}`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
