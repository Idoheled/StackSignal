# StackSignal

[![CI and Cloudflare](https://github.com/Idoheled/StackSignal/actions/workflows/ci.yml/badge.svg)](https://github.com/Idoheled/StackSignal/actions/workflows/ci.yml)

Private engineering intelligence, from silicon to tokens. StackSignal gathers technical publications, project releases and documentation updates for an AI infrastructure team, with explainable ranking and an organized shared library.

**[Open the team workspace](https://stacksignal.stacksignal-idoheled.workers.dev)** · **[Architecture](docs/ARCHITECTURE.md)** · **[Deployment](docs/DEPLOYMENT.md)** · **[Development](docs/DEVELOPMENT.md)**

## Product

- Weekly publisher-dated suggestions, followed GitHub releases, newly discovered projects and changed documentation.
- Administrator-editable watches, release channels, polling intervals, public discovery queries and topic preferences.
- Helpful feedback, saved links, nested shared folders and recursive saved-title search.
- Shared discussion and author-private notes; confirmation and recoverable trash for destructive actions.
- Invitation-only username/password accounts, administrator/maintainer/reader roles, required writer MFA, audited changes and rate limits.
- Responsive reading cards and a full-width detail pane on phones; a bounded drawer on larger screens. Keyboard dismissal, reachable close controls, safe-area spacing and independent scrolling.

## Quick start

Use Node.js 24 and pnpm **11.25.0**, pinned in `package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm typecheck:collector
pnpm test
pnpm build:standalone
```

For browser checks on a supported developer machine:

```sh
pnpm exec playwright install --with-deps chromium firefox webkit
pnpm test:browser
```

Tests use synthetic browser API responses and PGlite for database policies. They require no production account or provider credentials. Do not copy production secrets into local development.

## Delivery

Pull requests run quality checks without deployment credentials. Successful pushes to `main` deploy the verified standalone artifact to the existing Cloudflare Worker, then check anonymous denial, configured authentication and security headers. Runtime secrets stay in Cloudflare. The initial pipeline requires a scoped `CLOUDFLARE_API_TOKEN` in Actions secrets; see [deployment setup](docs/DEPLOYMENT.md).

The existing Supabase project, administrator, import and five-minute collector schedule are configured. **Do not bootstrap the administrator, reset the database or repeat the original import.** Frontend deployment does not automatically apply migrations or deploy collector changes.

## Repository map

| Path | Responsibility |
| --- | --- |
| `app/` | App entry, API dispatch, styles and viewport metadata |
| `components/` | Workspace, accounts, administration and UI primitives |
| `lib/server/` | Session encryption, provider Auth and authorization gateway |
| `lib/`, `data/` | Domain types, URL handling, technical profile and sanitized seed references |
| `supabase/migrations/` | Schema, RLS, role/MFA checks, invitations and queues |
| `supabase/functions/` | Bounded collection, extraction and ranking |
| `tests/` | Security, database, discovery, collector and browser regressions |
| `scripts/` | Builds, validation, guarded deployment and initial setup utilities |
| `.github/` | CI/CD, ownership, contribution templates and dependency maintenance |
| `docs/` | Architecture, development, deployment, security, coverage and operations |
| `build/`, `vendor/` | Preserved third-party integration code and notices |

## Documentation

- [Architecture](docs/ARCHITECTURE.md), [development](docs/DEVELOPMENT.md) and [deployment/rollback](docs/DEPLOYMENT.md)
- [Initial independent setup](docs/SETUP.md) and [existing operations checkpoint](docs/OPERATIONS.md)
- [Security policy](SECURITY.md), [implementation controls and limits](docs/SECURITY.md)
- [Coverage and provenance](docs/COVERAGE.md), [contributing](CONTRIBUTING.md), [changelog](CHANGELOG.md)

## Cost and limits

Collection, releases, public project discovery and local ranking do not require a paid AI API. Optional Gemini/Tavily integrations are disabled. Consumer AI subscriptions do not provide unlimited API usage. Free provider quotas are finite; collection defers work when a budget is exhausted.

This hub cannot guarantee every relevant page, independently validate benchmark claims or replace a backup. Browser-engine coverage is not certification of every physical device. Raw chats, colleague identities and internal topology are excluded from the imported public references.

The owner-only Sites deployment remains a separate fallback publication. Its audience is preserved; team access uses the Cloudflare URL above.
