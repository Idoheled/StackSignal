# Onboarding

[Documentation hub](README.md) · [Product guide](PRODUCT.md) · [Architecture](ARCHITECTURE.md)

StackSignal connects public engineering discovery with a private shared library. Your first steps depend on whether you consume knowledge, curate it, change the code or operate the services.

## Team members

### Join and sign in

1. Receive an invitation link from the administrator. Public signup is disabled. Invitation links expire after 24 hours, are single-use and can be revoked.
2. Open the link, choose a username and set a strong passphrase. Usernames start with a letter and use 3–32 lowercase letters, digits, underscores or hyphens. The system normalizes case.
3. Use a passphrase of at least **16 characters**, within **72 UTF-8 bytes**. Special characters are allowed; common patterns are rejected. Non-ASCII characters can occupy multiple bytes.
4. Administrators and maintainers enroll a TOTP authenticator, then verify its current six-digit code. Keep the setup key and password private. Read-only accounts do not require writer MFA.
5. Open the [team workspace](https://stacksignal.stacksignal-idoheled.workers.dev). Use **This week** to catch up, then **Releases** and **New to radar** to widen the view.

No email address is required in the product login. The identity provider uses internal, non-deliverable identifiers behind the username interface.

If the authenticator code fails, check the phone's automatic date/time and try a fresh code. For account recovery, contact the owner through your established team channel; do not post passwords or authenticator keys in repository issues. The protected owner account has a separate provider-level recovery path; there is no application backdoor.

### Make your first useful contribution

For administrators and maintainers:

1. Open a relevant item and read its source context and original publication.
2. Mark it helpful when the technical content is useful. Use **Not relevant** only after reviewing and confirming it.
3. Save the item to a shared folder. Use a name that explains the engineering question, such as `Inference / KV cache`.
4. Add a team note explaining applicability, version constraints or a next experiment. Choose **private** for your own note.
5. Paste a missed public link through the submission flow. Add a reason so the intended connection is clear.

Read-only members can read suggestions, saved links and visible notes, search/filter, and maintain read state. They cannot like/dismiss, save, submit or write notes.

## Roles and permissions

| Capability | Administrator | Maintainer | Read-only (`reader`) |
| --- | --- | --- | --- |
| Read suggestions, saved links and visible notes | Yes | Yes | Yes |
| Search/filter and mark items read | Yes | Yes | Yes |
| Helpful/not-relevant feedback | Yes | Yes | No |
| Submit/save links and manage shared folders | Yes | Yes | No |
| Write team/private notes and replies | Yes | Yes | No |
| Edit own notes | Yes | Yes | No |
| Delete others' team notes | Yes | No | No |
| Read another member's private notes through the app | No | No | No |
| Configure watches, release channels and discovery profile | Yes | No | No |
| Invite, disable, change roles or issue member recovery links | Yes | No | No |
| Required TOTP before workspace access | Yes | Yes | No |

The administrator is the protected owner. Invitations create maintainers or readers; they do not grant another administrator role. Member/role changes revoke the affected application sessions. Provider/database operators remain privileged outside application roles.

## Administrators

### Establish the team's working structure

- Invite a small first group and verify a real invitation acceptance, role boundary and sign-in flow before broad onboarding.
- Choose maintainers for contributors who save references, write notes and give ranking feedback. Choose readers for consumption-only access.
- Agree on a few shared folder roots. Folders are team-wide, not separate personal libraries; private note visibility does not make a folder private.
- Keep invitation links out of public issues. Revoke an unused invitation when it is no longer needed.

### Tune discovery deliberately

1. Review **Sources** and the administration controls. Last-success/error fields show whether watches are actually fetching.
2. Follow core GitHub projects by repository URL. Choose topic, priority, polling interval and whether prereleases are useful.
3. Add approved publication feeds or documentation pages. A new domain may require a reviewed collector allowlist change by an operator; source editing alone cannot grant arbitrary fetching.
4. Adjust technical interests, topic priorities, minimum relevance and repository queries. Keep broad exploration alongside concrete stack terms.
5. Inspect results and health after the queue runs. A manual scan makes work due; it does not bypass quotas or fetch synchronously.
6. Pause or remove stale watches with confirmation. Removing a watch preserves existing articles, saved links and notes.

Gemini/Tavily are currently disabled and their budgets default to zero. Enabling either involves provider credentials and explicit budget review, not just broader keywords. See [coverage](COVERAGE.md) and [design decisions](DESIGN.md).

## Developers

### Safe first checkout

```sh
git clone https://github.com/Idoheled/StackSignal.git
cd StackSignal
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm typecheck:collector
pnpm test
pnpm build:standalone
node scripts/verify-client-boundary.mjs
```

Use Node.js 24 and pinned pnpm 11.25.0. The test suite uses synthetic fixtures/PGlite; it does not need production credentials or accounts. Keep the lockfile, dependency overrides and third-party notices.

For browser regressions on a supported machine:

```sh
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm test:browser
```

The suite starts the built app and intercepts its API with synthetic responses. It checks the UI, not genuine production login or live provider integration. In a managed authoring environment without supported browser control, use hosted GitHub browser CI rather than improvising a local browser.

`pnpm dev` runs the framework development workflow. A real integration session needs a separately configured test backend, origin and secret bindings. [.env.example](../.env.example) is a configuration inventory with placeholders; it is not permission to copy production secrets. Follow [independent setup](SETUP.md) with isolated resources when integration testing is necessary. Do not repoint development at production or enable the owner-private preview flag on a public origin.

### Follow a feature through the source

Read these files in order for a representative shared-library action:

1. [`components/workspace.tsx`](../components/workspace.tsx): interaction and client state.
2. [`lib/client.ts`](../lib/client.ts): same-origin JSON API calls.
3. [`app/api/[...path]/route.ts`](../app/api/%5B...path%5D/route.ts) and [`lib/server/service.ts`](../lib/server/service.ts): dispatch, live identity verification, validation and authorization gateway.
4. [`lib/server/security.ts`](../lib/server/security.ts): request bounds, origins and encrypted sessions.
5. [`supabase/migrations/`](../supabase/migrations/): current database schema/RPCs plus subsequent replacements. Read later migrations as well as the base schema.
6. [`tests/database.test.mjs`](../tests/database.test.mjs) and [`tests/security.test.ts`](../tests/security.test.ts): permission and request-security regressions.

For collection, start with [`supabase/functions/collector/index.ts`](../supabase/functions/collector/index.ts), then its [shared modules](../supabase/functions/_shared/) and [`lib/source-config.ts`](../lib/source-config.ts).

Use [CONTRIBUTING.md](../CONTRIBUTING.md) for your first PR. UI changes need phone/landscape/tablet coverage; authorization changes need negative permission tests; schema changes need a separate rollout/recovery plan.

## Operators

### Learn the existing system before changing it

The team Cloudflare Worker, Supabase project, administrator, historical import and five-minute collection schedule are configured. The owner-only Sites publication is a separate fallback. Read [deployment](DEPLOYMENT.md) for exact existing targets and [operations history](OPERATIONS.md) for recorded evidence.

**Do not repeat bootstrap, reset the database, rerun a changed historical import, create replacement resources or regenerate runtime secrets as a repair step.**

| Change | Release path |
| --- | --- |
| Frontend/website gateway | Reviewed commit to `main` → GitHub quality gate → existing Worker → live smoke checks |
| Database schema/RPC | Reconcile live migration history, back up, apply only new reviewed migrations, verify permissions |
| Collector code | Deploy the reviewed Edge Function separately; verify authorization, one real collection and health |
| Watches/technical profile | Administrator changes through the app; verify subsequent queue/source health |
| Secrets or provider settings | Coordinated provider-level operation; preserve accounts and verify affected flows |

Cloudflare rollback/revert does not reverse database changes or collector writes. Application exports are useful curation exports, not a full authentication/database backup. A failed live smoke check requires investigation; automatic rollback is not implemented.

Before inviting the full team, review genuine second-account access, account recovery, provider limits and a backup/restore procedure. Existing checks are documented in [security verification limits](SECURITY.md).
