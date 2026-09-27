# StackSignal

Private engineering intelligence, from silicon to tokens. Built for a small expert AI infrastructure team: a rolling weekly feed, explainable relevance, shared nested collections, recursive saved-title search, private notes, team discussion, and owner-controlled invitations.

**Delivery status:** the application, database migration, collector, setup scripts and private interactive preview are implemented. Production authentication, scheduled collection and external providers require your own account configuration. The preview contains explicitly labelled public reference material and temporary, in-memory interactions; it is not a live news feed or a substitute for the secured database.

## Start here

Read **[docs/SETUP.md](docs/SETUP.md)** for the exact Cloudflare + Supabase deployment steps. No paid plan or AI API is required for feed collection and rule-based ranking. Search and AI analysis are optional, quota-limited additions. Free services have finite quotas, availability limits and changing terms; this is not an unlimited-capacity promise.

- **Cloudflare Workers:** website and server API. Your final deployment uses a free `workers.dev` subdomain.
- **Supabase:** PostgreSQL, managed password hashing, MFA, cron and ingestion functions.
- **Tavily, optional:** basic web discovery, capped at 800 requests/month by default.
- **Gemini, optional:** analysis of public source text; bounded daily calls, no search grounding, no private chats/notes sent to the model. A consumer subscription is not an unlimited API entitlement.
- **Sites preview:** privately hosted for the owner. Its outer access gate is separate from the final team's username/password login.

## Implemented workflows

- This week: only publisher-dated material from the previous seven days. Updated documentation has a separate tab; undated discoveries remain in All discoveries.
- Titles, source, known author, publication/discovery/update dates, tags, short summary, rationale and an original-source link. Dates are never invented.
- The weekly feed excludes low-match material (score below 45); All discoveries retains it for review. Helpful votes and hidden signals affect personal topic ranking. Submissions can be marked as positive examples. Administrator coverage and query controls seed the broader team focus.
- Shared folders and unlimited practical nesting, move/rename, multi-folder saves and search across every descendant. PostgreSQL prevents folder cycles.
- Plain-text shared notes/replies and author-private notes. Private notes are excluded from other users' queries, including the owner's content export.
- Confirmation dialogs and server-side confirmation checks for destructive/negative actions. Deleted folders/notes are recoverable for 30 days; maintenance then purges them.
- Exactly one owner, invite-only maintainers and readers, usernames, strong passphrases, mandatory TOTP for writers, one-time invitations, disabling, password-reset links and an audit log.
- Source health, editable registry, source pause/resume, queue status, integration usage and JSON content export.
- Dark/light themes, keyboard-accessible dialogs and a responsive mobile sidebar.

## Development and verification

Use Node 24 and the pinned pnpm version from `package.json`:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build:standalone
```

`pnpm test` includes a real PostgreSQL engine in WebAssembly (PGlite with pgcrypto), not a mocked SQL parser. It checks access policies, role restrictions, MFA gating, recursive search, private-note isolation, cycle prevention, invitation reuse, session revocation, quotas and job leasing. Separate tests check cookie integrity, origins, body limits, anonymous denial and collection safety.

The managed Sites preview uses the bundled build workflow. For your own Cloudflare deployment use **only `build:standalone`**, which omits the Sites-specific outer authentication layer while retaining StackSignal's application authentication.

## Project map

| Path | Purpose |
|---|---|
| `components/workspace.tsx`, `admin-panel.tsx`, `access.tsx` | Application and account flows |
| `lib/server/` | Secure session gateway, request validation and Auth integration |
| `supabase/migrations/001_stacksignal.sql` | Data model, RLS, authorization RPCs, queues and maintenance |
| `supabase/functions/collector/` | Feed, release, documentation and discovery ingestion |
| `supabase/functions/_shared/` | Bounded, text-only source extraction and URL allowlist |
| `scripts/` | Bootstrap, secret generation/upload and standalone build |
| `docs/` | Setup, security and operational handoff |

## Scope and remaining validation

The source catalogue starts with 22 official feeds/releases/docs. It is extensible; it cannot discover every new page on the internet. Additional Cisco/Dell/HPE topics are in the relevance profile; add the exact vendor sources and discovery queries your team trusts. Search discovery requires its optional provider.

Live provider integration, scheduled collection, backup restoration, and a 100-user load test must be verified against the actual configured accounts. The current checks do not amount to an independent penetration test. See [docs/SECURITY.md](docs/SECURITY.md) for the precise trust boundaries and known limits.

Share your selected links and redacted chats when ready. They can refine the source catalogue and profile; do not upload credentials, infrastructure secrets or confidential third-party data.
