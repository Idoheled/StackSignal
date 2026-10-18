# Security model and verification limits

## Trust boundaries

1. The browser receives no Supabase key, service credential, refresh token or AI key. React renders third-party content as text; no scraped HTML or markdown HTML is executed.
2. A Cloudflare Worker validates same-origin JSON requests, body size, CAPTCHA and persistent rate limits. It verifies access tokens with Supabase Auth. The encrypted, authenticated session cookie is Secure, HttpOnly, SameSite=Lax, host-only and limited to 12 hours.
3. PostgreSQL independently requires an active member and an unrevoked server-created session on every API/RLS read. Writers need AAL2 and completed temporary-password replacement. The owner cannot be demoted through the application. No browser role can mutate tables directly.
4. Shared-library changes use explicit role checks and audited RPCs. Notes are author-private or team-visible; even the owner cannot query another member's private notes through the app. Supabase project operators still control the underlying database; these are not end-to-end encrypted notes.
5. Invitations and reset tokens are random, hashed at rest, time limited and single use. Invitation claims use a locked five-minute lease and compensating cleanup when Auth creation fails. There is a hard 100-member cap, including disabled members; this is a product limit, not a validated load benchmark.
6. The collector is separate from user-facing APIs and protected by a 256-bit secret. Exact trusted hosts, HTTPS, DNS public-IPv4 checks, redirect validation, byte/time bounds and text-only extraction reduce SSRF and parser risk. No arbitrary URL can expand the host allowlist. Operators must not trust hostile or internally resolving domains: allowlisting is the primary DNS-rebinding boundary, and the current fetch implementation does not pin DNS responses. Only controlled, trusted publisher hosts belong there.
7. Public source text is untrusted even when it looks like an instruction. Gemini has no tools or workspace data; its structured output is bounded and checked, including an evidence substring. Scores are relevance estimates, never proof that an article or benchmark is correct. Model/provider errors keep affected links out of suggestions; normal collection continues.
8. Service-only private attempt reservations bound Gemini usage atomically across concurrent runs (rolling 24 hours, Pacific calendar day, UTC calendar month and five-minute spacing), including failed attempts. Cached public input avoids repeat evaluations. Search uses basic requests with no answer generation; Gemini grounding is not used. Do not enable paid provider billing/overages if zero spend is mandatory.

## Deployed defense layers

TLS/HSTS, nosniff, no-referrer, restricted browser permissions, no-store HTML/API responses, CSP restricted to the app and Cloudflare Turnstile, safe external links, and a robots exclusion. Server-rendered scripts receive a fresh per-response nonce through Cloudflare HTMLRewriter. The script policy uses nonces and strict-dynamic, without unsafe-inline; inline styles remain permitted for the component library. There is no custom untrusted HTML rendering.

Cloudflare provides network-level protection on its platform; the app adds per-IP/login/member limits backed by atomic database counters. This reduces abuse but is not an unlimited DDoS guarantee or a replacement for an independently reviewed WAF configuration. Rate-limiter/database failures fail requests closed. Turnstile must also be configured in Supabase Auth to guard direct password authentication.

Private access on the owner preview uses the hosting platform's outer access boundary. A standalone deployment removes that outer boundary and relies on this application's login, MFA and database policies. It remains invitation-only; assets and the login shell are intentionally public. The imported in-memory preview requires both an unconfigured backend and an exact `STACKSIGNAL_PRIVATE_PREVIEW_ORIGIN` match. This flag is enabled only behind the owner-private hosting gate. It must not be set on an open deployment. The catalog is absent from public client bundles; normal library data is read through authenticated server requests.

## Tests completed in this workspace

- TypeScript compilation and source-extraction syntax validation.
- Authenticated session encryption and tamper rejection; malformed/oversized/cross-origin requests; anonymous denial and generic login failure messages.
- PGlite/PostgreSQL running the actual migration, RLS and authorization functions: writer MFA, strict readers, author-private notes, recursive saved-title search, folder-cycle rejection, confirmations, trash restoration, hashed single-use invite claims, protected owner, immediate user disabling, atomic budget caps and job leases.
- Interactive browser review of the private preview and key local workflows.

## Live verification and remaining limits

Owner login, password change and a fresh TOTP enrollment were completed on October 10. Tavily was activated on October 11: production function-secret installation succeeded, real search jobs completed and persisted results, and unauthorized collector requests still returned 401. Its first 20-query sweep stored 86 references; see [operations evidence](OPERATIONS.md#tavily-web-search-activation--october-11). Gemini comparison was activated later that day on a confirmed Free-tier API project; its first `gemini-flash-latest` assessment resolved to `gemini-3.8-flash` and was saved without changing the feed. Remaining checks include all-source availability, ongoing provider quota/result quality, ongoing Gemini assessment quality, full backup restoration, independent penetration testing and 100-user traffic/load behavior. On October 10, missing/invalid CAPTCHA tokens were denied by the live Auth password endpoint, authenticated collector requests succeeded, unauthorized collector requests returned 401, and the KServe release watch completed successfully. The first scheduled collector invocation at 10:20 UTC returned HTTP 200 and completed seven jobs. Published runtime revision 3 reports configured login and disabled preview; anonymous account and preview access are denied. Administrator bootstrap and the live import succeeded on October 2; neither needs to run again. Complete the remaining go-live checks in SETUP.md before onboarding the full team.

On October 3, live anonymous API probes denied article access (`401/42501`) and rejected `net`, `cron` and `vault` as unexposed schemas (`406/PGRST106`). Vault and Cron deny client schema access. The platform-owned `pg_net` extension retains default SQL grants, including queue access, which the project role cannot revoke; its isolation therefore also depends on keeping it outside the Data API, exposing no arbitrary SQL proxy and protecting privileged database credentials.

The live Auth advisor also reports leaked-password protection as disabled. Supabase provides its HaveIBeenPwned integration only on Pro and higher plans; this zero-spend deployment does not enable that paid feature. The application enforces length/common-pattern checks and writer MFA, but those checks are not a comprehensive leaked-password database. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security).

## Operational cautions

Use separate API projects/keys dedicated to this application, MFA on hosting/database accounts and a private repository. Keep no secrets in source, screenshots, API responses, audit content or GitHub Actions logs. CI may build/test; do not use CI as a continuous production crawler. Never paste infrastructure secrets or raw confidential chats into a free model service.

Sensitive provider configuration is a security boundary: changing roles, auth password policy, CAPTCHA settings, database grants or the collector allowlist deserves review. This implementation is a tested starting point, not a claim that unauthorized access is impossible.

Team imports use an invoker-security, service-only function. The payload is transactionally applied, keyed and hashed; re-running an identical batch does not overwrite user edits. The Free Supabase project and schema were provisioned on October 2, 2026. Live advisors were checked: private service-only tables intentionally have RLS with no client policies. The `ss_api` security-definer endpoint is an intentional, authenticated-only interface; it checks bound sessions, current membership, MFA and action-specific permissions before accessing data. Its advisor warning must not be dismissed as a blanket approval for other security-definer functions. See [the advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Provider credentials and CAPTCHA are configured; the owner has verified the genuine human login flow. Team invitation acceptance and role flows still need a real second account.

## October 10 security review

The review covered authentication and CAPTCHA, encrypted cookies, session revocation, MFA, invite/recovery claims, role and private-note isolation, database grants/RLS, collector SSRF and prompt-injection boundaries, dependency advisories and deployment access. Source text is never executed, model outputs cannot invoke tools, and automatic fetching remains restricted to trusted public hosts.

Findings fixed: provider-revoked sessions and removed TOTP factors are now checked against live Auth records, in addition to application-session revocation; expired folder trash no longer aborts daily maintenance because of bookmark references; dependency security patches and a nonce-based script policy replace the previous vulnerable pins and permissive inline-script policy. The real owner login, first password change and TOTP enrollment were confirmed on October 10.

This is a code/configuration review with targeted automated and live negative tests, not an independent penetration test, restore drill or 100-user load certification. Keep the deployment owner-only until team access and the recovery/backup operating procedure have been reviewed.

### Dependency audit disposition

On October 10, production dependency advisories were addressed by upgrading Next to 16.3.8, React/React DOM/RSC to 19.2.8, Vite to 8.0.16 and affected transitive packages. The complete development dependency audit still reports three advisories: unpatched `braces` 3.0.3 (high: deeply nested glob patterns), `esbuild` 0.18.20 through Drizzle tooling (moderate: development-server origin access), and `esbuild` 0.27.3 through Wrangler (low: Windows development-server file access). These are build/development paths, not deployed application endpoints. Build inputs are trusted repository files; do not process untrusted glob patterns or expose a development server. This is an explicit residual risk, not a clean full audit. Recheck upstream patches before toolchain upgrades.

### Discovery boundary

Only administrators can add/edit/delete watches or change public discovery queries; maintainers and readers are rejected by the database. Stable releases are the default, drafts are excluded, and prereleases require opt-in. Deleted/paused/reconfigured watches invalidate queued analysis through source revisions. The queue reserves work across source, analysis, metadata and discovery lanes. Provider throttling defers jobs without consuming failure attempts. Public repository searches exclude forks, archived and private projects; remote content is text-only and cannot execute code. In-app alerts use the canonical article and each member's read state, so polling does not generate duplicate unread alerts.

Team feedback contributes bounded technical-tag weights; private note text, usernames and feedback reasons are never sent to discovery providers. New to radar uses first-discovered time, while the weekly feed uses actual publication dates. RSS parsing and GitHub results are bounded; the service cannot guarantee exhaustive internet coverage.

The follow-up compatibility checks passed all 22 automated tests, both app/collector TypeScript checks and the production build. Migration tests exercise legacy GitHub URL deduplication, release-provenance repair without changing publication dates, and prerelease opt-in across suggestions, archive and unread counts. Live verification confirms the unique watch index, preserved MFA gates, denied anonymous RPC access, unchanged library counts and the existing five-minute schedule. This pass used no automated browser session.

At 20:28 UTC the Supabase security advisor had no new findings. Its eight [RLS-without-policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) describe intentionally inaccessible service tables; the authenticated RPC warning and disabled leaked-password protection remain as explained above.

Gemini's free-tier activation requires a verified Free API project. The evaluator uses `gemini-flash-latest` at the owner's request. Zero spend depends on keeping the API project on the Free tier; the application cannot infer its billing tier from the key. There is no alternate-model or paid fallback. If the alias becomes unavailable on the Free tier, provider failure pauses evaluation and collection retains rules. Only captured public excerpts and recognized public stack vocabulary are sent; free-form profile text and private collaboration content are excluded. Structured output and exact quotes are checked locally, with uncertain results preserving rules. Compare preserves stored scores, but suggested-feed admission still requires useful, supported AI review. See [evaluation privacy and limits](GEMINI_EVALUATION.md).

The saved evaluation mode survives deploys because preferences and the usage ledger remain in PostgreSQL. On-demand batches of up to five links supplement atomic 16-request rolling/Pacific-day and 496-request/month caps. Coverage snapshots distinguish reviewed, queued and failed public inputs; ordinary collection continues independently; release alerts require review. Free-tier provider capacity is project/model-specific and cannot be established from an API key. Quota errors retain rules, flag the input and stop further generation for 24 hours; transient HTTP 5xx capacity errors back off for 15 minutes. Never enable billing to resolve free-tier capacity errors automatically.

Repository maintenance and OpenShift probes use bounded approved-host fetches. Only public GitHub metadata enters health snapshots; private repositories are not evaluation candidates. New AI candidate RPC is service-only. Current-policy SQL admission prevents unqualified GitHub content from appearing or spending model quota. Popularity and model review are relevance controls, not security audits.

## WhatsApp registration review — October 18, 2026

The additive registration RPCs use the existing active-session/member/MFA gate,
lock only the caller's member row and never accept a target user ID. Direct
member updates and anonymous execution remain denied. Confirmation records a
member declaration; it does not assert an automated WhatsApp membership check.
Only opted-in members receive the private invite. The new confirmation RPC is
an intentional authenticated security-definer API with explicit grants, an
empty search path and tested authorization, consistent with the existing
preferences API. The advisor reports these intentional endpoints and private
tables without client policies; no new blanket grants or policies were added.
Leaked-password protection remains the previously documented provider-tier
limitation. The bot still has no database service credential and cannot process
inbound personal or group messages.
