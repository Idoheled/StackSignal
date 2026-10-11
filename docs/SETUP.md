# Deploy StackSignal on your free accounts

The existing private website, Supabase Free project (`plbjscbpvfozqvexmqhk`, Frankfurt), administrator and original library import are live. On October 10 the owner completed the password change and TOTP enrollment, Turnstile protection was verified, and the collector's five-minute schedule was activated. Runtime environment revision 3 contains the required integration secrets. Do not re-bootstrap the administrator, regenerate runtime secrets, or repeat the historical import. See [OPERATIONS.md](OPERATIONS.md) before continuing.

The assistant can apply the prepared migrations, deploy the collector and inspect the database through that connection. Provider sign-in, terms acceptance and account ownership steps must be completed in the provider’s secure interface. No password or API key needs to be pasted into chat.

The team website is now https://stacksignal.stacksignal-idoheled.workers.dev on the owner's existing Cloudflare account. It uses the same Supabase accounts, library, username/password login and MFA. The original Sites website remains owner-only. The owner should confirm login on the team URL before creating team invitations there.

The steps below are for a new independent deployment. They are not outstanding setup tasks for either existing site.

## 1. Get the source and tools

Extract the delivered source archive. Install Node.js 24, the pinned pnpm version using Corepack, and the official Supabase CLI. In the project directory:

```sh
corepack enable
pnpm install --frozen-lockfile
node scripts/generate-secrets.mjs
```

This creates `.env.setup` with random 256-bit session and collector secrets, file permissions 0600, and blank provider values. This file and the administrator credential file are ignored by git. Keep them in your password manager; never upload them with your source archive.

## 2. Create a Supabase Free project

1. Create a project at https://supabase.com/dashboard. Keep the database password in your password manager; choose the region nearest your team.
2. Apply every SQL file in `supabase/migrations/` in filename order, exactly once. These are migrations, not repeatable reset scripts. The existing project already has its schema; check migration history before applying anything again.
3. Copy the project's URL and **legacy anon** and **service_role** API keys into `.env.setup`. The current gateway uses the JWT-format legacy keys. Do not use a publishable key in the service-role field.
4. In Authentication settings, disable **Allow new users to sign up**. Disable unused identity providers, anonymous sign-ins and phone sign-ins. Keep email/password auth available internally; usernames map to non-deliverable internal identifiers. There is no public signup form or email login UI.
5. Set password minimum length to **16** and enable **Require current password when changing password**. Set access-token lifetime to 3600 seconds and retain refresh-token rotation/reuse detection. Avoid email-based reauthentication: these internal accounts have no mailbox. Application sessions are bounded to 12 hours.
6. Enable TOTP MFA. The database requires verified MFA for every administrator/maintainer content request. Readers can access the application at AAL1.

No raw password is stored in application tables. Supabase Auth stores bcrypt hashes and salts. Usernames must remain readable to identify accounts; account identifiers are not passwords and are not hashed.

## 3. Create the Cloudflare website and Turnstile widget

Sign into a Cloudflare Free account and enable Workers with a free `workers.dev` subdomain. Do not choose a paid Workers plan.

```sh
pnpm exec wrangler login
pnpm build:standalone
pnpm exec wrangler deploy --config dist/server/wrangler.json
```

This first deployment has no backend secrets and **fails closed**. Only the login shell is available. The imported reading list preview is disabled on standalone/public deployments. Copy the exact HTTPS URL printed by Wrangler into `APP_ORIGIN` in `.env.setup`, with no trailing slash.

In Cloudflare Turnstile, create a **Managed** widget and authorize that exact hostname. Put its site key and secret key into `.env.setup`.

Back in Supabase Authentication protection settings, enable CAPTCHA with provider **Turnstile**, using that same secret. This is required: login delegates CAPTCHA verification to Supabase exactly once; registration/recovery validate it at the server before using the Admin API. Both share the widget's hostname restriction.

Set the Supabase Auth Site URL to your worker origin; allow only that origin in any redirect allowlist. Do not add wildcards.

Upload only website secrets:

```sh
node scripts/upload-worker-secrets.mjs
```

The script passes secrets over stdin to Wrangler. It does not put secret values in shell arguments. If you change the hostname later, update APP_ORIGIN, Turnstile's hostname list and the Supabase site URL together.

## 4. Create your Administrator

```sh
node scripts/bootstrap-admin.mjs
```

The script creates exactly one `administrator` account and a random temporary password, then atomically imports 136 public references, 29 folders and 57 source watches. Re-running it preserves the owner password, renamed folders, and any existing content. An import batch cannot silently change after it has been applied.

For an existing administrator, run `node scripts/import-team-library.mjs` to import the library. The equivalent prepared SQL is `supabase/seed-team.sql`; it must run with administrative privileges after administrator creation. Source fetches are queued only for approved hosts. Fifteen short links remain unresolved and five alternatives are explicitly labelled as title matches. All imported publication dates start unknown; sharing timestamps are not used as publication dates.

Open the local `.bootstrap-credentials.txt` file. Sign into the website with that username/password, choose your permanent passphrase, sign in again, and enroll TOTP using your authenticator. Save the authenticator secret in a secure password manager before completing enrollment. Delete the temporary credential file after the password change.

The application creates **no universal default password**. Your password is generated locally when your own backend is configured.

In Administration → People & access, generate a maintainer or read-only invitation. Copy it into a trusted private channel. The recipient chooses a username and passphrase. A link is single use, valid for 24 hours and stored hashed; only the owner can issue one. Writers enroll TOTP before accessing content.

## 5. Deploy and schedule the collector

Using the official Supabase CLI:

```sh
supabase login
node scripts/upload-collector-secrets.mjs
supabase functions deploy collector --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

Replace `YOUR_PROJECT_REF` with the identifier in your Supabase project URL. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the Edge Function by Supabase; the upload script adds the collector secret and optional providers.

The function checks its own 256-bit `x-collector-secret` for every invocation; disabling the platform JWT check does **not** make the handler publicly callable without that secret.

Apply `supabase/hosted/*_hosted_collector_runtime.sql` once to enable **Cron** and **pg_net**; **Vault** is provided by Supabase. This hosted infrastructure script is separate from the application migrations because the embedded PostgreSQL test runtime cannot run background workers. Check the hosted migration history before applying it. In Vault, create:

| Secret name | Value |
|---|---|
| `stacksignal_collector_url` | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/collector` |
| `stacksignal_collector_secret` | The `COLLECTOR_SECRET` from your local setup file |

Run `supabase/cron.sql` in the SQL editor. It prepares a **paused** job and preserves an existing job on repeat runs. First install the matching Edge Function secret and verify an authenticated invocation returns success. Then use the activation statement at the bottom of that file. The active job invokes the worker every five minutes and keeps seven days of its scheduler run history. Each invocation processes up to eight jobs. Core runtime releases are checked every two hours, most operators every four hours, and documentation/selected issues every twelve hours; administrators may reduce an interval to 30 minutes. GitHub requests share a conservative hourly budget, and sources with an existing pending job are not queued again. Backlog or source throttling may increase discovery latency.

Keep `net`, `cron` and `vault` out of the exposed Data API schemas. The managed `pg_net` extension retains platform-owned database role grants; do not assume a privilege-revocation command changed these. The October 3 live check confirmed that anonymous Data API requests to all three internal schemas return `406/PGRST106`, and article access is denied with `401/42501`.

Verify the cron run history and collector function logs. Open Sources in StackSignal: the first successful polls should acquire timestamps, followed by new items as queued extraction finishes. Undated material appears in All discoveries, not This week. A source that errors is visible as needing attention; it is not silently reported healthy.

## 6. Optional discovery and AI

You can skip this entire step. The app still collects configured RSS/release/documentation sources and uses deterministic topic scoring.

- **Tavily:** create a free API key, add `TAVILY_API_KEY`. Search calls start disabled. Set a ceiling of at most 800 basic searches/month after configuring the provider. Queries run once daily; additional source feeds run independently. Do not enable automatic paid overages. Only generic administrator-authored search queries leave the workspace.
- **Gemini:** use a Google AI Studio project marked Free with available `gemini-3.5-flash-lite` quota; set only `GEMINI_API_KEY` in function secrets. Start in Compare only with at most four attempts per rolling 24 hours and 100 per month, globally spaced one hour apart. Actual project limits can be lower. Model failures pause evaluation while rules and discovery continue. See [activation and privacy](GEMINI_EVALUATION.md).
- **GitHub:** public releases work without a token. `GITHUB_READ_TOKEN` is optional if you need a higher API limit; use minimal read-only privileges, no repository write access.

Re-run `node scripts/upload-collector-secrets.mjs` after changing optional keys. Update usage ceilings in Administration → Coverage. Provider-side limits are authoritative; the local ceilings are an additional safeguard.

For a new publisher, add its source in Administration. Collection uses an **exact trusted-host allowlist**. If the publisher is not included, independently verify that it is an official, public, HTTPS host and add its hostname to `COLLECTOR_ALLOWED_HOSTS` (comma separated) in `.env.setup`; upload collector secrets again. Do not add user-controlled hosting wildcard domains or internal domains. Unapproved links may be saved and opened, but their pages are not fetched automatically.

## 7. Verify before inviting the whole team

Use a maintainer and a read-only test member. Confirm:

- Anonymous `/api/action` requests cannot read content, and unknown registrations fail.
- Both writers must complete MFA; readers cannot curate or comment.
- Private notes are invisible to another account, including the owner.
- A one-time invite cannot be reused, and disabling a member stops an already-open session on its next request.
- Saves, recursive folder search, notes and trash restore persist after reload.
- Cron runs successfully, new publications have actual source dates, and integration usage stays within your limits.
- Export shared content and perform a database backup/restore rehearsal. A 100-user concurrency/load test against the configured deployment is still required before treating that capacity as verified.

## Maintenance, upgrades and recovery

Commit your source into a **private** Git repository you control. The delivered project is already versioned in its private hosting source repository; GitHub account access was not available here. To create your own separate history after extracting the archive:

```sh
git init
git add .
git commit -m "Initial StackSignal implementation"
git branch -M main
git remote add origin YOUR_PRIVATE_GIT_REMOTE
git push -u origin main
```

Before any push, confirm `.env.setup` and `.bootstrap-credentials.txt` are ignored. For upgrades, review dependency changes, run `pnpm typecheck` and `pnpm test`, apply any new migrations, build with `pnpm build:standalone`, and deploy with the same Wrangler command. Keep previous deploy versions for rollback; do not roll back a database by deleting tables.

Free-tier services have no uptime guarantee. Monitor database usage, job failures, source freshness and provider quotas; a paused Supabase project must be resumed in its dashboard. Unbookmarked articles expire after 90 days, completed/failed jobs after 7 days, audit events after 90 days, and trash after 30 days. Saved links and active notes are retained; monitor growth before the free database fills up.

The in-app export is a content export, not a full disaster-recovery backup. It omits other members' private notes and all credentials. Keep a separate encrypted database backup using Supabase's supported CLI/database export procedure, and protect it as sensitive. Free plans may not offer downloadable managed backups.

For a member who forgot a password, use the admin-generated one-hour recovery link. It does not reset their TOTP factor. If the owner loses their password or authenticator, recovery requires your Supabase project's privileged dashboard/Admin API access; there is no application backdoor or email fallback. Secure those provider accounts with MFA and retain recovery codes.

## Private import preview

`STACKSIGNAL_PRIVATE_PREVIEW_ORIGIN` is set only on the owner-private Sites deployment. It allows a no-store preview response on that exact origin while the backend is unconfigured. The imported catalog is served by the Worker, not embedded in public JavaScript assets. Remove this variable before making any deployment public. Once Auth is configured, the preview endpoint closes and all library reads require a valid application session. Never copy this variable into standalone production configuration.

## Release alerts and discovery controls

In **Administration → Coverage**, add a public GitHub repository URL (for example `https://github.com/kserve/kserve`) and select **GitHub project / releases**. Choose stable-only or include prereleases, a priority and a polling interval. Click an existing source to edit it, request another check or remove its watch; removing a watch preserves articles, bookmarks and notes. Pause/resume and removal require confirmation.

**Discover → Releases** lists followed releases published in the past week. The unread-release banner is personal and clears as those links are opened. **New to radar** shows recently discovered projects/publications, including older material that is newly useful to the team. It does not pretend that discovery time is publication time. **All discoveries** keeps the full retained archive searchable.

Public project search runs daily with up to twelve editable GitHub queries, bounded rate limits and alternating recency/popularity ordering. Four additional feeds cover arXiv distributed systems/machine learning, PyTorch and NetBox. All watches are editable. Automatic fetching stays on the approved public publisher hosts in `supabase/functions/_shared/content.ts`; adding another domain requires an operator review/change to that allowlist, not browser access to arbitrary internal URLs.

Review match reasons and use Helpful / Not relevant. Personal ranking responds to your topic/tag feedback, and future analysis also uses bounded aggregate technical-tag feedback. Coverage preferences set the match threshold and topic priorities. **Health & audit** shows delayed sources, job failures, discovery success/partial results and provider budgets. None of these signals establishes that a benchmark claim has been independently reproduced.

No Gemini or external web-search API is enabled. Public feeds, release polling, local relevance and GitHub project discovery work without those services. They expand coverage but cannot guarantee every relevant document or project across the web.
