# Security model and verification limits

## Trust boundaries

1. The browser receives no Supabase key, service credential, refresh token or AI key. React renders third-party content as text; no scraped HTML or markdown HTML is executed.
2. A Cloudflare Worker validates same-origin JSON requests, body size, CAPTCHA and persistent rate limits. It verifies access tokens with Supabase Auth. The encrypted, authenticated session cookie is Secure, HttpOnly, SameSite=Lax, host-only and limited to 12 hours.
3. PostgreSQL independently requires an active member and an unrevoked server-created session on every API/RLS read. Writers need AAL2 and completed temporary-password replacement. The owner cannot be demoted through the application. No browser role can mutate tables directly.
4. Shared-library changes use explicit role checks and audited RPCs. Notes are author-private or team-visible; even the owner cannot query another member's private notes through the app. Supabase project operators still control the underlying database; these are not end-to-end encrypted notes.
5. Invitations and reset tokens are random, hashed at rest, time limited and single use. Invitation claims use a locked five-minute lease and compensating cleanup when Auth creation fails. There is a hard 100-member cap, including disabled members; this is a product limit, not a validated load benchmark.
6. The collector is separate from user-facing APIs and protected by a 256-bit secret. Exact trusted hosts, HTTPS, DNS public-IPv4 checks, redirect validation, byte/time bounds and text-only extraction reduce SSRF and parser risk. No arbitrary URL can expand the host allowlist. Operators must not trust hostile or internally resolving domains: allowlisting is the primary DNS-rebinding boundary, and the current fetch implementation does not pin DNS responses. Only controlled, trusted publisher hosts belong there.
7. Public source text is untrusted even when it looks like an instruction. Gemini has no tools or workspace data; its structured output is bounded and checked, including an evidence substring. Scores are relevance estimates, never proof that an article or benchmark is correct. Model/provider errors fall back to deterministic rules.
8. Counter reservations bound optional provider usage atomically. Search uses basic requests with no answer generation; Gemini grounding is not used. Do not enable paid provider billing/overages if zero spend is mandatory.

## Deployed defense layers

TLS/HSTS, nosniff, no-referrer, restricted browser permissions, no-store HTML/API responses, CSP restricted to the app and Cloudflare Turnstile, safe external links, and a robots exclusion. The framework's streamed bootstrap currently requires `unsafe-inline` scripts/styles; there is no custom untrusted HTML rendering. A nonce-based CSP is a future hardening item, not claimed as implemented.

Cloudflare provides network-level protection on its platform; the app adds per-IP/login/member limits backed by atomic database counters. This reduces abuse but is not an unlimited DDoS guarantee or a replacement for an independently reviewed WAF configuration. Rate-limiter/database failures fail requests closed. Turnstile must also be configured in Supabase Auth to guard direct password authentication.

Private access on the owner preview uses the hosting platform's outer access boundary. A standalone deployment removes that outer boundary and relies on this application's login, MFA and database policies. It remains invitation-only; assets and the login shell are intentionally public. The imported in-memory preview requires both an unconfigured backend and an exact `STACKSIGNAL_PRIVATE_PREVIEW_ORIGIN` match. This flag is enabled only behind the owner-private hosting gate. It must not be set on an open deployment. The catalog is absent from public client bundles; normal library data is read through authenticated server requests.

## Tests completed in this workspace

- TypeScript compilation and source-extraction syntax validation.
- Authenticated session encryption and tamper rejection; malformed/oversized/cross-origin requests; anonymous denial and generic login failure messages.
- PGlite/PostgreSQL running the actual migration, RLS and authorization functions: writer MFA, strict readers, author-private notes, recursive saved-title search, folder-cycle rejection, confirmations, trash restoration, hashed single-use invite claims, protected owner, immediate user disabling, atomic budget caps and job leases.
- Interactive browser review of the private preview and key local workflows.

## Not yet verified with live accounts

Genuine human Supabase Auth/Turnstile login, password change and TOTP enrollment; all-source availability; optional Gemini/Tavily responses and quotas; full backup restoration; independent penetration testing; and 100-user traffic/load behavior. On October 10, missing/invalid CAPTCHA tokens were denied by the live Auth password endpoint, authenticated collector requests succeeded, unauthorized collector requests returned 401, and the KServe release watch completed successfully. The first scheduled collector invocation at 10:20 UTC returned HTTP 200 and completed seven jobs. Published runtime revision 3 reports configured login and disabled preview; anonymous account and preview access are denied. Administrator bootstrap and the live import succeeded on October 2; neither needs to run again. Complete the remaining go-live checks in SETUP.md before onboarding the full team.

On October 3, live anonymous API probes denied article access (`401/42501`) and rejected `net`, `cron` and `vault` as unexposed schemas (`406/PGRST106`). Vault and Cron deny client schema access. The platform-owned `pg_net` extension retains default SQL grants, including queue access, which the project role cannot revoke; its isolation therefore also depends on keeping it outside the Data API, exposing no arbitrary SQL proxy and protecting privileged database credentials.

The live Auth advisor also reports leaked-password protection as disabled. Supabase provides its HaveIBeenPwned integration only on Pro and higher plans; this zero-spend deployment does not enable that paid feature. The application enforces length/common-pattern checks and writer MFA, but those checks are not a comprehensive leaked-password database. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security).

## Operational cautions

Use separate API projects/keys dedicated to this application, MFA on hosting/database accounts and a private repository. Keep no secrets in source, screenshots, API responses, audit content or GitHub Actions logs. CI may build/test; do not use CI as a continuous production crawler. Never paste infrastructure secrets or raw confidential chats into a free model service.

Sensitive provider configuration is a security boundary: changing roles, auth password policy, CAPTCHA settings, database grants or the collector allowlist deserves review. This implementation is a tested starting point, not a claim that unauthorized access is impossible.

Team imports use an invoker-security, service-only function. The payload is transactionally applied, keyed and hashed; re-running an identical batch does not overwrite user edits. The Free Supabase project and schema were provisioned on October 2, 2026. Live advisors were checked: private service-only tables intentionally have RLS with no client policies. The `ss_api` security-definer endpoint is an intentional, authenticated-only interface; it checks bound sessions, current membership, MFA and action-specific permissions before accessing data. Its advisor warning must not be dismissed as a blanket approval for other security-definer functions. See [the advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Provider credentials and CAPTCHA are now configured; genuine human account verification remains required.
