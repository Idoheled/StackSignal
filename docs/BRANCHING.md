# Branching and repository maintenance

| Branch | Purpose | Merge and deployment rule |
| --- | --- | --- |
| `main` | Production history | Protected; a reviewed release PR, required Quality checks and owner approval. Only this branch deploys the public Cloudflare app and publishes releases. |
| `dev` | Integration for the next release | Feature/fix/documentation PRs target here. CI validates changes; pushes never deploy production. |
| `feat/<topic>` | One bounded feature | Start from `dev`, test in a private preview, merge by PR, then delete after merge. |
| `fix/<topic>`, `docs/<topic>` | Focused fixes and documentation | Same integration path as features. Urgent production fixes may target `main`, then must be brought back into `dev`. |
| `dependabot/*` | Temporary dependency proposals | Reviewed and tested like other changes; delete when merged or closed. These contain package/lockfile changes, not a knowledge archive. |

Keep branches synchronized by merging or rebasing your own unshared feature
work. Never force-push protected branches or rewrite published release tags.
Prefer a squash merge for a focused feature; use a merge commit for the release
PR so production and integration retain their relationship. Synchronize `dev`
after a production hotfix. Delete completed temporary branches, not unmerged
work with unique implementation.

## Dependency maintenance

Dependabot version updates target `dev`, run weekly and have bounded open-PR
limits. Minor/patch development updates and production patches are grouped;
major upgrades receive separate compatibility review. GitHub security updates
continue to use the default branch according to GitHub's security-update rules.

The three October 11, 2026 proposals (PRs #1–#3) changed only `package.json` and
`pnpm-lock.yaml`. They carried no unique application or infrastructure knowledge.
They were superseded during adoption of the integration branch; their closed
PRs retain the exact diff and review history. The TypeScript/ESLint major
upgrades in #1 were not silently incorporated into the WhatsApp release.

## Workflows and operational code

CI runs for PRs and pushes to `main` and `dev`, plus explicit manual requests.
Production/release jobs remain guarded to `main`. WhatsApp maintenance is an
owner-only manual operation with a short-lived encrypted request, exact commit
identity, an existing-host guard and temporary SSH ingress cleanup. It cannot
allocate a VM. No workflow has an hourly resource-claim schedule.

The retired OCI resource allocator is preserved under [ops/oci](../ops/oci/README.md).
Its workflow template stays outside `.github/workflows`; the database control
flag remains false and its cron job is deleted. Restoration is a separate,
explicit operation. Never rerun provisioning against the paired host.

## Documentation ownership

README and architecture describe current concepts; product/onboarding describe
user behavior; deployment/setup describe reproducible operations; Operations
records dated production changes. The WhatsApp checkpoint is the current
rollout status, and the archive is historical context. Do not duplicate private
credentials, phone numbers, invite tokens, destination IDs or database exports
in any branch. Closed PRs and Git history preserve superseded experiments;
active documentation should not require replaying them.
