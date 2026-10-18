# Repository releases

StackSignal uses stable semantic versions in `package.json`, matching dated entries in `CHANGELOG.md`, and permanent GitHub tags named `vX.Y.Z`. The first published version is `v0.1.0`, the existing package version and production source baseline at `e2a75f03730eda44f41a605c688b1e7ac995659b`. Automated release management starts with `v0.1.1`. Earlier dated changelog entries remain as unversioned history; no historical tags or deployments are invented.

## Prepare a release

1. Add concrete changes under `## [Unreleased]` in `CHANGELOG.md`. Include user-visible behavior, fixes and any migration or collector rollout requirements.
2. Choose the next version: patch for fixes, minor for features, major for incompatible changes. Before 1.0, document incompatible changes explicitly and use a minor bump. This process publishes stable versions only.
3. Run `pnpm release:prepare 0.1.2` (replace with the intended version). The command increments `package.json`, freezes the Unreleased notes into a dated entry, and leaves an empty Unreleased section for future work. It does not commit, push or publish.
4. Review both files, run `pnpm release:check` and `pnpm test`, and commit the release with the associated changes. Use the normal PR/review process; required Quality checks still apply.
5. After feature PRs pass into `dev`, open the release PR from `dev` to `main`. Obtain owner approval of the private preview and merge the reviewed release PR. The existing **CI and Cloudflare** workflow runs all checks, deploys the verified artifact, and runs production smoke checks. Its **GitHub Release** job then publishes the matching version automatically.

Do not bump versions for every maintenance commit. Ordinary main updates continue to deploy; a version already published causes release publication to skip. A release is a named source/deployment checkpoint. Published notes and tags are not automatically rewritten when later commits arrive.

## Publication guarantees

- `release:check` rejects missing, duplicate, empty or mismatched version notes before the build/deployment gate.
- The release job requires both **Quality** and **Production** to succeed. Failed or skipped jobs, pull requests and other repositories/branches cannot publish.
- Publication uses the job's ephemeral `GITHUB_TOKEN` with `contents: write`; no personal token or additional provider secret is required. Other jobs retain their existing permissions.
- The tag points to that run's exact tested commit. Existing tags are checked and never moved. Superseded main runs skip publication.
- Each GitHub release includes the changelog notes, commit SHA, validation-run URL and deployment/rollback guide. GitHub supplies source archives for the tag; generated Worker bundles, runtime configuration and secrets are not attached.
- Publication is serialized. Rerunning a completed release is a no-op. After a transient failure, rerun the failed **GitHub Release** job; it can resume from a matching tag or draft. A conflicting tag requires investigation and a new version, not a forced update.
- Stable releases become GitHub's latest release. A lower or equal unpublished version cannot replace a newer published release.

The release job does not deploy a second copy of the app or modify the owner-only Sites fallback. Database migrations and collector deployment remain separate authorized operations; record their actual outcomes in [Operations](OPERATIONS.md). Tagging source never proves that every migration in the repository has been applied live.

## Verify or recover

Check [GitHub Releases](https://github.com/Idoheled/StackSignal/releases) and the linked Actions run. **Quality**, **Production** and **GitHub Release** must succeed for a new release. Inspect the tag's commit and notes.

For a frontend incident, follow [Deployment and rollback](DEPLOYMENT.md#rollback). Retain the release/tag as an audit checkpoint, make a revert or forward-fix commit, and publish a new patch version when appropriate. GitHub release deletion or retagging is not a production rollback and does not restore database content.
