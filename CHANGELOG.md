# Changelog

## [Unreleased]

## [0.3.2] - 2026-10-18

- Use English-first replies for the installed local model after an isolated
  bilingual audit reproduced poor Hebrew. Both Hebrew name spellings receive
  a maintained English-language recommendation; English prefixes answer directly.
- Keep general Columbus questions free of unrelated article context and answer
  identity questions from maintained platform facts.
- Reject sentence fragments, avoid grammar-forced mid-word string closure and
  require qualified technical claims in deployment samples.
- Structure generated replies into a direct answer, useful points and optional
  limitations; prioritize correct language over forced sarcasm and retry invalid
  final output once within a bounded deadline.
- Add semantic local-model deployment checks and an encrypted synthetic bilingual
  audit without reading real chats or sending test messages.

- Preserve the pinned WhatsApp ignored-packet acknowledgement protocol at the
  pre-decryption boundary; acknowledge metadata only and count rejected frames
  without reading personal ciphertext or sending private chat replies.

- Answer exact capabilities questions deterministically in Hebrew and English,
  and recognize name prefixes preceded by mobile RTL direction marks.
- Record bounded receive-stage counters so incoming group frames, local send
  echoes and rejected messages can be distinguished without storing chat text.

## [0.3.1] - 2026-10-18

- Fix the Administration page crashing when the database returns a null job
  aggregate for an empty queue, with mobile and desktop browser regressions.
- Add owner-only, read-only, encrypted Columbus runtime diagnostics without
  restarting services or returning chat messages and contact addresses.

## [0.3.0] - 2026-10-18

- Add administrator BI and health monitoring with measured content/user statistics,
  durable problem/recovery notifications and independent VM watchdog checks.
- Answer recent-release questions from the signed platform catalog; provide
  explicit bounded replies for busy, rate-limited and failed requests.
- Handle authenticated linked-phone group routing while blocking personal
  ciphertext, and pass the private host environment to signed catalog canaries.
- Cap review batches at the verified size and isolate rejected multi-item
  request shapes through smaller retries, preserving every quota reservation.
- Recover obsolete provider-configuration retries and superseded source failures
  without resetting quota accounting, historical evaluations or alert cutoffs.

## [0.2.2] - 2026-10-18

- Require Columbus question replies to use a strict final-answer JSON field;
  request non-thinking generation and never forward raw text, separate thinking,
  reasoning markers or token-truncated output. Preserve the English/Hebrew
  persona and fixed-group boundary.
- Add malformed/reasoning-output regressions and a guarded English/Hebrew live
  Ollama smoke mode that sends no messages and preserves the paired host.

## [0.2.1] - 2026-10-18

- Fix first-review WhatsApp alerts for collector records containing JSON
  `evaluation: null`; preserve the activation cutoff, no-backfill policy and
  existing-review suppression. Add database regressions for both pending forms.
- Remove account identities and membership details from public operating notes;
  retain private database audit records and technical deployment evidence.

## [0.2.0] - 2026-10-18

### WhatsApp registration, alerts and Columbus

- Add optional signup registration, authenticated join/confirmation dialogs,
  Registered/Pending/Unregistered tracking, administrator visibility and an
  explicit WhatsApp exit reminder when unregistering.
- Record confirmation source, timestamps and audited transitions; preserve
  invitation atomicity, session/MFA authorization and old preference callers.
- Add signed webhook dispatch, a private reviewed-content outbox, SQLite
  duplicate protection, delivery receipts and reconciliation for uncertain sends.
- Pair the existing Oracle ARM host and verify a real StackSignal-group
  announcement through OpenClaw; use local Ollama for message generation.
- Retire resource polling and preserve its dormant toolkit outside active
  workflows. Document `main`/`dev`/feature conventions and dependency maintenance.
- Add English/Hebrew Columbus questions with local Ollama, a fixed-group socket
  boundary, no tools, trusted alert context and persistent reply deduplication.
- Require new discovery plus first evaluation after activation; exclude old
  pending links and reevaluations, and include searchable titles in alerts.
- Repair Unicode excerpt slicing so scheduled internal reviews cannot fail an
  entire batch on a split emoji; diagnose provider configuration failures safely.
- Gate activation on owner approval, verified production rollout and live bot
  tests. Operational evidence and activation state live in the rollout checkpoint.

## [0.1.1] - 2026-10-13

### Release management

- Prepare stable semantic versions and freeze Unreleased notes with `pnpm release:prepare`; validate matching version/changelog entries in CI.
- Publish GitHub releases automatically only after Quality, verified production deployment and live smoke checks succeed.
- Tag the exact tested commit, preserve existing tags and published releases, reject version regressions and conflicting tags, and recover matching tags/drafts after publication failures.
- Record the source commit, validation run and deployment/rollback links in each release; isolate write permission to the release job using its ephemeral GitHub token.
- Document preparation, rollout scope and recovery; add eight release regressions, bringing the automated suite to 67 tests.

## [0.1.0] - 2026-10-13

First versioned release of StackSignal, cut from `e2a75f03730eda44f41a605c688b1e7ac995659b`, including the production improvements recorded below.

### Discovery and review

- Follow the official GitHub repositories for NVIDIA NIC Configuration, Network and Maintenance Operators hourly, including administrator-enabled beta and RC releases.
- Review discovered links through bounded Gemini batches and an evidence-bound local review path; tolerate provider 503 errors, timeouts and delayed extraction without losing queue state.
- Persist link review states, preserve completed evidence and rankings, and permanently delete non-selected links and their dependent data. Keep aggregate discard counts only.
- Enrich short public excerpts and full arXiv abstracts; avoid replaying unchanged feeds after rejected links are deleted.
- Require repository maintenance signals and useful review for discovery; monitor GitHub Trending and official OpenShift release streams.
- Show the latest approved release per project, preserving canonical project names in cards and search.

### Workspace and operations

- Provide a shared reference library with folders, notes, feedback, personal reading state and administrator coverage controls.
- Protect username/password/MFA access and private data; preserve saved settings and review history across deployments.
- Validate application and collector types, policy/database tests, client boundaries and responsive browsers before deploying the verified Cloudflare build and running production smoke checks.

### Rollout scope

- This tag records the current source baseline. Creating a GitHub release does not apply database migrations, deploy the collector, reimport references or reset existing data.
- Frontend deployment and live smoke checks are recorded in the linked CI run; database and collector rollout history remains in [Operations](https://github.com/Idoheled/StackSignal/blob/main/docs/OPERATIONS.md).

## 2026-10-13

- Preserve the GitHub project name in release titles and search, including legacy reviewed snapshots containing only a version tag.

- Add a model-free, evidence-bound review path for unresolved links after 24 hours and qualifying fresh direct-source material.
- Record service-only assistant backlog decisions with content/input guards and approved review history.
- Persist database-managed link states and permanently delete non-selected decisions with history, claims, jobs, bookmarks, notes, feedback and comparison data; keep aggregate discard counts only.
- Delete completed job payloads and preserve request-level quota accounting after article deletion.
- Move overdue collection failures into the local review path without restarting their original discovery clock.
- Exclude publisher AI summaries from mechanism evidence, keep raw model responses out of error ledgers, and expose recorded primary-source corroboration.
- Enrich short public RSS/search excerpts during collection independently of Gemini availability; match legacy URL aliases without losing retained review history.
- Preserve completed internal review scores in the database when publisher metadata changes, and repair previously drifted stored scores.
- Compare source-wide RSS fingerprints to avoid replaying unchanged feeds after rejected links are deleted, without retaining per-link tombstones.
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
