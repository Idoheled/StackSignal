# Changelog

## 2026-10-11 — Batched, reviewed-only discovery

- Evaluate up to five public links per Flash Latest request with independent identity and evidence validation.
- Enforce service-only request/claim ledgers: 16 requests per rolling/Pacific day, 496 per UTC month and five-minute spacing; historical reservations preserved.
- Withhold pending, uncertain, failed and irrelevant material from every suggested-feed mode and release alerts; retain saved library access.
- Queue approved-host public extraction, bounded delayed retries and one enrichment for insufficient snippets. Preserve cached ranking on metadata-only updates.
- Show pending-review status and request/coverage diagnostics; document quota capacity and limitations.

## 2026-10-11

- Preserved the owner's saved Apply preference across deployments; added month-aware pacing, an oldest-pending public-input queue without seven-day expiry, and administrator coverage/failure counts. Hard 4/day and 100/month attempt caps remain enforced independently.

- Switched semantic evaluation to the owner-requested `gemini-flash-latest` alias, low thinking and recorded resolved model versions; retained all usage, evidence and privacy controls.

- Conservative Flash Latest semantic evaluation: administrator Compare / Apply / Off controls, public-context sampling, exact-evidence validation and cached comparisons.
- Service-only atomic evaluation reservations enforce four attempts in rolling 24 hours, 100 monthly and one-hour spacing, including failures; provider errors pause for 24 hours.

- Activated genuine Tavily searches using server-side function secrets; verified the first full 20-query sweep and persisted results.
- Documented discovery engines, saved-query selection, exact scoring arithmetic, personal/team feedback and known quality limits; updated Mermaid architecture and production checkpoints.
- Focused Tavily web discovery with rotating recent/exploration queries, bounded basic-search usage, canonical deduplication, noise filtering, truthful snippet/date provenance and administrator health status.
- Branded repository landing page, role-based onboarding, product guide, documentation hub and design decision records; expanded architecture and trust-boundary diagrams.
- Wrap long titles, tags and metadata inside cards/details.
- Full-width phone details with dynamic viewport height, safe-area spacing, independent scrolling and a persistent 44-pixel close control.
- Readable phone inputs, wrapping actions and keyboard focus/dismissal.
- Three-engine responsive regressions at eight phone/tablet/laptop sizes.
- Guarded Actions deployment with pinned actions, verified artifacts and production smoke checks.
- Architecture, development, deployment/rollback, contribution and security documentation.

- Team website deployed on the existing Cloudflare account, preserving username/password/MFA, library and five-minute collection.
- Bounded GitHub pagination and oversized-response recovery.

## 2026-10-10

- Followed-release alerts, editable watches/channels/priorities, public discovery and coverage preferences.
- Provider-session/current-MFA validation and per-response CSP nonces.
