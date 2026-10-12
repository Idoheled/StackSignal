# Changelog

## 2026-10-13

- Add a model-free, evidence-bound review path for unresolved links after 24 hours and qualifying fresh direct-source material.
- Record service-only assistant backlog decisions with content/input guards and approved review history.
- Persist database-managed link states and permanently delete non-selected decisions with history, claims, jobs, bookmarks, notes, feedback and comparison data; keep aggregate discard counts only.
- Delete completed job payloads and preserve request-level quota accounting after article deletion.
- Move overdue collection failures into the local review path without restarting their original discovery clock.
- Capture full arXiv abstracts and enrich new paper announcements.
- Label local reviews explicitly and preserve their ranking after metadata refreshes.
- Prevent a racing Gemini response from replacing a completed review.


## 2026-10-12

- Skip unchanged watched publisher content and prioritize new core releases within the ingestion lane.
- Run semantic evaluation independently of source collection every five minutes.
- Increase bounded synchronous batches to twelve while preserving the 16/day and 496/month request ceilings and historical reviews.
- Keep transport failures retryable with exponential backoff, jitter, Retry-After and a 90-second timeout; adapt batch size after timeouts/invalid output.
- Apply explicit first-party watch exceptions and hourly checks for the three NVIDIA network operators; keep normal discovery popularity thresholds.
- Show measured arrivals, evaluations, retry backlog, policy exclusions and oldest queued link in administrator Health.


## 2026-10-11 — One current release per project

- Show only the latest approved, channel-eligible release of each project across discovery and hidden views; retain older saved releases in the shared library.
- Select the current release before search, personal read/dismiss filters, score sorting and pagination; apply the same selection to weekly and unread-release counts.
- Normalize GitHub project casing using canonical release URLs, group OpenShift streams as one project, compare numeric version components and preview sequences, and fall back to publisher dates for other tag schemes.
- Preserve all historical articles, reviews, bookmarks and notes; no collection or Gemini quota changes.
- Add database regressions for maintenance-branch patches, pagination/search, pending reviews, per-member state, saved history, OpenShift channel opt-in and deterministic date ties.

## 2026-10-11 — Maintained repositories and platform release probes

- Enforce administrator-editable GitHub stars, actual watchers, recent releases, activity and declared-license gates before AI reservation and feed admission; preserve saved references.
- Add daily/weekly top-five GitHub Trending probes with truthful publisher rank and relevance review.
- Monitor official OpenShift 4/5 stable and dev-preview release streams; decode per-release changelogs and label RC/engineering previews and CI acceptance.
- Import an idempotent, sanitized second reading batch; add kagent, agent sandboxes, gateway authorization, cache research and collective communication coverage.
- Add repository health diagnostics, service-only candidate selection, source-type/channel validation and regression tests.
- Separate discovery queue identities by lane/period so weekly Trending is not suppressed by the daily probe; accommodate bounded official OpenShift changelogs without widening ordinary page limits.

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
