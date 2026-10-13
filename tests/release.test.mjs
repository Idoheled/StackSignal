import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, releaseNotes, prepareRelease, publishRelease } from "../scripts/release.mjs";

const sha = "a".repeat(40);
const env = {
  GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "Idoheled/StackSignal", GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "push", GITHUB_SHA: sha, GITHUB_RUN_ID: "123", QUALITY_RESULT: "success", PRODUCTION_RESULT: "success",
};
const changelog = "# Changelog\n\n## [Unreleased]\n\n- Retry provider failures.\n\n## [0.1.0] - 2026-10-13\n\n- Initial release.\n\n## 2026-10-12\n\n- Historical change.\n";
const options = { version: "0.1.0", notes: "- Initial release.", env };

function github({ released = false, draft = false, tagSha, annotated = false, latest, heads = [sha], failPublish = false } = {}) {
  const calls = [];
  let headReads = 0;
  const request = async (path, args = {}) => {
    calls.push({ path, ...args });
    if (path === "/releases/tags/v0.1.0") return released
      ? { id: 7, draft: false, prerelease: false, html_url: "https://github.com/Idoheled/StackSignal/releases/tag/v0.1.0" } : null;
    if (path === "/releases?per_page=100&page=1") return draft
      ? [{ id: 7, tag_name: "v0.1.0", draft: true }] : [];
    if (path === "/git/ref/heads/main") return { object: { sha: heads[Math.min(headReads++, heads.length - 1)] } };
    if (path === "/releases/latest") return latest ? { tag_name: latest } : null;
    if (path === "/git/ref/tags/v0.1.0") return tagSha ? { object: { type: annotated ? "tag" : "commit", sha: tagSha } } : null;
    if (path === `/git/tags/${tagSha}`) return { object: { type: "commit", sha } };
    if (path === "/git/refs" && args.method === "POST") return { object: { sha } };
    if (["/releases", "/releases/7"].includes(path)) {
      if (failPublish) throw new Error("temporary publication failure");
      return { html_url: "https://github.com/Idoheled/StackSignal/releases/tag/v0.1.0" };
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  return { calls, request };
}

test("release notes match the package version and omit historical sections", () => {
  assert.equal(releaseNotes("0.1.0", changelog), "- Initial release.");
  assert.throws(() => releaseNotes("0.2.0", changelog), /match package.json/);
  assert.throws(() => releaseNotes("0.1.0", changelog + "\n## [0.1.0] - 2026-10-14\n\n- Duplicate.\n"), /unique/);
  assert.throws(() => releaseNotes("0.1.0", "## [0.1.0] - 2026-10-13\n\nTBD\n"), /concrete change/);
  for (const bad of ["v0.1.0", "01.1.0", "0.1", "0.1.0-beta.1", "0.1.0\n"])
    assert.throws(() => compareVersions(bad, "0.1.0"), /semantic version/);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
});

test("preparation freezes Unreleased changes and preserves old history", () => {
  const next = prepareRelease({ name: "stacksignal", version: "0.1.0", private: true }, changelog, "0.1.1", "2026-10-14");
  assert.equal(next.pkg.version, "0.1.1");
  assert.equal(next.pkg.private, true);
  assert.equal(releaseNotes("0.1.1", next.changelog), "- Retry provider failures.");
  assert.ok(next.changelog.includes("## [Unreleased]\n\n## [0.1.1] - 2026-10-14"));
  assert.ok(next.changelog.endsWith(changelog.slice(changelog.indexOf("## [0.1.0]"))));
  assert.throws(() => prepareRelease({ version: "0.1.0" }, changelog, "0.1.0"), /must increase/);
  assert.throws(() => prepareRelease({ version: "0.1.0" }, changelog.replace("- Retry provider failures.", ""), "0.1.1"), /Unreleased/);
});

test("untrusted contexts or failed validation never reach GitHub", async () => {
  for (const override of [
    { GITHUB_ACTIONS: "false" }, { GITHUB_REPOSITORY: "other/repo" }, { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_SHA: "invalid" }, { QUALITY_RESULT: "failure" },
    { PRODUCTION_RESULT: "skipped" },
  ]) {
    const mock = github();
    await assert.rejects(publishRelease({ ...options, env: { ...env, ...override }, request: mock.request }), /successful Quality/);
    assert.equal(mock.calls.length, 0);
  }
});

test("successful publication tags only the tested commit and supplies provenance", async () => {
  const mock = github();
  const result = await publishRelease({ ...options, request: mock.request });
  assert.equal(result.state, "published");
  const writes = mock.calls.filter(c => c.method);
  assert.deepEqual(writes[0].body, { ref: "refs/tags/v0.1.0", sha });
  assert.equal(writes[1].body.target_commitish, sha);
  assert.equal(writes[1].body.make_latest, "true");
  assert.equal(writes[1].body.draft, false);
  assert.match(writes[1].body.body, /actions\/runs\/123/);
});

test("published versions are idempotent even after later main pushes", async () => {
  const mock = github({ released: true, heads: ["b".repeat(40)] });
  assert.equal((await publishRelease({ ...options, request: mock.request })).state, "existing");
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls.filter(c => c.method).length, 0);
});

test("superseded commits cannot publish a release", async () => {
  for (const heads of [["b".repeat(40)], [sha, "b".repeat(40)]]) {
    const mock = github({ heads });
    assert.equal((await publishRelease({ ...options, request: mock.request })).state, "superseded");
    assert.ok(!mock.calls.some(c => c.path === "/releases"));
  }
});

test("a conflicting tag and version regression fail without moving tags", async () => {
  const conflict = github({ tagSha: "b".repeat(40) });
  await assert.rejects(publishRelease({ ...options, request: conflict.request }), /another commit/);
  assert.ok(!conflict.calls.some(c => c.method));
  const regression = github({ latest: "v0.2.0" });
  await assert.rejects(publishRelease({ ...options, request: regression.request }), /newer/);
  assert.ok(!regression.calls.some(c => c.method));
});

test("failed publication can resume from the same tag or an existing draft", async () => {
  const fail = github({ failPublish: true });
  await assert.rejects(publishRelease({ ...options, request: fail.request }), /temporary/);
  for (const settings of [{ tagSha: sha }, { tagSha: "c".repeat(40), annotated: true }, { tagSha: sha, draft: true }]) {
    const mock = github(settings);
    assert.equal((await publishRelease({ ...options, request: mock.request })).state, "published");
    assert.ok(!mock.calls.some(c => c.path === "/git/refs"));
    assert.equal(mock.calls.at(-1).method, settings.draft ? "PATCH" : "POST");
  }
});
