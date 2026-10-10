# StackSignal

Private engineering intelligence, from silicon to tokens. Built for a small expert AI infrastructure team: a rolling weekly feed, explainable relevance, shared nested collections, recursive saved-title search, private notes, team discussion, and owner-controlled invitations.

**Delivery status (October 3, 2026):** the private site is published, the Supabase database and collector are deployed, and the administrator plus all 136 links, 29 folders and 57 source watches exist in the live database. Signup is disabled and the 16-character password policy is saved. The site has its protected database/session configuration. Turnstile and the collector's Edge Function secret still need activation; the five-minute collector schedule is prepared and paused. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for the exact continuation checkpoint. The private preview still uses temporary, in-memory interactions until login is configured; it is not a live news feed.

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
| `supabase/migrations/` | Data model, RLS, authorization RPCs, queues and maintenance |
| `supabase/functions/collector/` | Feed, release, documentation and discovery ingestion |
| `supabase/functions/_shared/` | Bounded, text-only source extraction and URL allowlist |
| `scripts/` | Bootstrap, secret generation/upload and standalone build |
| `docs/` | Setup, security and operational handoff |

## Scope and remaining validation

The tailored catalog contains 136 public links, organized into 29 folders, and 57 release/feed/documentation/issue watches. It covers the team’s stated stack from NIC/NUMA topology to KServe, llm-d, Dynamo, KV cache and token policies. Fifteen Google short links remain unresolved and five primary-page alternatives are labelled as title matches. See [docs/COVERAGE.md](docs/COVERAGE.md). It does not claim to discover every new page on the web; broader search uses an optional capped provider.

Live provider integration, scheduled collection, backup restoration, and a 100-user load test must be verified against the actual configured accounts. The current checks do not amount to an independent penetration test. See [docs/SECURITY.md](docs/SECURITY.md) for the precise trust boundaries and known limits.

The supplied chats were used only to derive technical interests. Raw messages, colleague identities, internal environment names and private topology are not part of the imported data. Public link labels do not endorse benchmark claims.
