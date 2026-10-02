# Deploy StackSignal on your free accounts

The owner-private website and tailored library preview are deployed. On October 2, 2026, the existing Free organization was used to create the **StackSignal** project in Frankfurt (`eu-central-1`), with project reference `plbjscbpvfozqvexmqhk`. The database schema and collector function are deployed. The collector rejects unauthenticated requests and remains inactive until its secret and schedule are configured. Live Auth, administrator creation, the database content import and Turnstile configuration are still pending provider dashboard access.

The assistant can apply the prepared migrations, deploy the collector and inspect the database through that connection. Provider sign-in, terms acceptance and account ownership steps must be completed in the provider’s secure interface. No password or API key needs to be pasted into chat.

The steps below are the reproducible fallback for someone deploying from the source archive. The existing private website remains available throughout setup.

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

Enable **Cron**, **pg_net** and **Vault** integrations in your Supabase project. In Vault, create:

| Secret name | Value |
|---|---|
| `stacksignal_collector_url` | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/collector` |
| `stacksignal_collector_secret` | The `COLLECTOR_SECRET` from your local setup file |

Run `supabase/cron.sql` once in the SQL editor. It invokes the worker every five minutes. Each invocation processes up to eight jobs. Core runtime releases are checked every two hours, most operators every four hours, and documentation/selected issues every twelve hours; administrators may reduce an interval to 30 minutes. GitHub requests share a conservative hourly budget, and sources with an existing pending job are not queued again. Backlog or source throttling may increase discovery latency.

Verify the cron run history and collector function logs. Open Sources in StackSignal: the first successful polls should acquire timestamps, followed by new items as queued extraction finishes. Undated material appears in All discoveries, not This week. A source that errors is visible as needing attention; it is not silently reported healthy.

## 6. Optional discovery and AI

You can skip this entire step. The app still collects configured RSS/release/documentation sources and uses deterministic topic scoring.

- **Tavily:** create a free API key, add `TAVILY_API_KEY`. Search calls start disabled. Set a ceiling of at most 800 basic searches/month after configuring the provider. Queries run once daily; additional source feeds run independently. Do not enable automatic paid overages. Only generic administrator-authored search queries leave the workspace.
- **Gemini:** create an API key in Google AI Studio for a project eligible for the free API tier. Select a currently supported free model and put its exact model ID in `GEMINI_MODEL`, with its key in `GEMINI_API_KEY`. Keep billing disabled for a strict zero-spend setup. AI calls start disabled. After configuring the provider, choose a small daily ceiling such as 20; the app falls back to topic rules after quota limits or provider errors. Your consumer Pro subscription does not remove API quotas. The collector sends only public article text and a generic technical taxonomy, never your notes, feedback rationale, usernames or chats.
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
