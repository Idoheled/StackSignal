# Durable reviewed discovery

StackSignal uses Tavily, public GitHub discovery and source watches to find links. The existing October 11 collection was reviewed by the assistant. Gemini **evaluates newly discovered URLs using public material captured by the collector**; it is not the search engine or an independent fact checker.

## Existing collection and handoff

The handoff froze 717 existing URLs, including URLs in pending collection jobs, at `2026-10-11T17:06:30.77093Z`. All 717 received assistant decisions: 336 useful, 272 not selected and 109 insufficient evidence. These are dated counts, not a promise that every reference is useful or accessible. Public excerpts, repository metadata/README text and release bodies supplied the evidence. GPU benchmarks and third-party code were not executed as part of the relevance review.

The database excludes the retained portion of this cohort at both Gemini candidate selection and atomic reservation. GitHub owner/repository casing does not create a new identity; release-tag casing is preserved. Approved old links are protected from routine Gemini reevaluation. Non-selected cohort entries were removed under the later deletion policy, so rediscovery can create fresh work for those URLs. No historical import is reapplied, and no provider quota ledger is reset.

Service-only `ss_apply_assistant_reviews` validates explicit decisions, exact source evidence and every acceptance gate before storing a reviewer/date and reviewed-content snapshot. Private history retains approved decisions only. Collector refreshes preserve approved reviews; changed public text is flagged against the original snapshot. Reviewed articles are excluded from routine 90-day cleanup. Bookmarks, notes, feedback and read states remain attached to retained article IDs. The October 13 owner-directed deletion policy removes all dependent records when a link fails review, including previously saved entries.

## What members see

GitHub links must first pass the [current repository maintenance policy](REPOSITORY_DISCOVERY.md). The same gate is enforced at candidate selection, atomic reservation and feed read. This does not certify code security or peer review.

Every suggested-feed mode, including releases and All reviewed, admits only completed, useful evidence assessments with medium/high confidence, practical/advanced depth, an exact source quote and a review score meeting the administrator's minimum score. Unresolved work and errors stay out of suggestions. Low-confidence judgments, introductory/tangential results, insufficient evidence and below-policy completed decisions are permanently deleted, including saved copies. Library titles and notes are not submitted to Google.

This week retains the publisher's seven-day date window. New to radar uses the assessment date, so a backlogged or undated reference can surface when its review completes without inventing a publication date. All reviewed has no age cutoff. Followed-release alerts and unread counts require review too, and respect prerelease settings.

Every discovery mode shows at most one latest approved, channel-eligible release per project. The database selects it before search, personal read/dismiss state, score sorting or pagination; weekly and unread-release counts use the same selection. Older maintenance-branch patches cannot displace a newer comparable version just because their score or publication date is higher. Nonversion tag schemes use publisher time. GitHub repository casing and legacy source labels do not split canonical project identity; official OpenShift streams share one project and honor preview opt-in, including in All reviewed. Documentation and PRs remain independent items.

An older approved release saved by any member remains in the shared library with its review and read state. Saving does not put superseded releases back in discovery. Approved review history is retained; completed job payloads are deleted. Pending or rejected new versions cannot replace the latest approved release. See [discovery selection rules](DISCOVERY.md#5-what-each-person-sees).

Apply mode uses the existing 70% AI / 30% rules blend for high-confidence Gemini assessments; medium-confidence assessments preserve stored rules scores. Admission uses the assessment decision and score independently, so useful unfamiliar tools can enter despite weak keyword overlap. Assistant reviews display and rank by their explicit assessment score. Cards identify the assistant or Gemini as reviewer; details retain the review date and flag subsequent content changes. Evaluate without changing ranking still gates suggestions; Off pauses new evaluations but retains completed reviews.

## Request and coverage budgets

| Control | Enforcement |
| --- | --- |
| Model | `gemini-flash-latest`; last resolved model recorded in Health |
| Batch size | Up to seven links in one synchronous `generateContent` request |
| Daily requests | At most 16 in a rolling 24 hours **and** the Pacific calendar day |
| Monthly requests | At most 496 per UTC calendar month; administrator may lower it |
| Spacing | At least five minutes globally, one request per independent evaluation tick |
| Public source input | At most 6,000 UTF-8 bytes of text and 500 bytes of title per link |
| Output | 900 generation tokens per link, at most 10,800 per request; LOW thinking |
| Timeout | 90 seconds; no immediate provider retries |
| Input retries | Five-minute in-flight lease; transient/configuration failures keep a durable retry time; three invalid-output failures require review |
| Provider errors | HTTP 408/429/5xx/network failures: exponential backoff with jitter (5 minutes to 2 hours), honoring Retry-After; auth/configuration: 24 hours; failures consume slots |
| Malformed batch | One-hour cooldown; smaller subsequent batches isolate invalid output |

The owner's October 11, 2026 AI Studio screenshots show **5 RPM, 250,000 input TPM and 20 RPD** for Gemini 3.8 Flash on a Free-tier project. Sixteen daily requests leave four requests of daily headroom. These quotas are shared by every client in the Google project and can change when the latest alias changes. Keep the project dedicated to StackSignal and on the Free tier. Application ceilings cannot prove or control the project's billing tier. There is no paid fallback or alternate-model retry.

**Sixteen requests × seven links gives an upper bound of 112 link assessments/day, not a throughput guarantee.** Small/failed batches, insufficient excerpts, unavailable sources and arrivals above capacity can cause delays. A monthly request ceiling is an application safeguard, not a Google monthly free allowance. Do not claim exhaustive discovery or instant review regardless of volume.

## Durable queue and extraction

The sweep loads the oldest/priority window of 200 eligible new-link public inputs **after excluding the frozen cohort and filtering GitHub repository health**, rotates preference among strong/borderline/exploration lanes and submits up to twelve atomically reserved inputs. Already leased inputs are skipped within the window, so an interrupted request does not unnecessarily block all other work. There is no seven-day queue expiry.

New references without public text enter a separate bounded extraction queue: up to eight records per tick, once per record, only for approved public hosts. Completed assistant reviews skip this bootstrap extraction. PDFs and unsupported hosts remain visible in administrator new-link coverage as missing public input. Public GitHub repository extraction uses API metadata and a bounded public README when available. Imported chat text, private notes and arbitrary user titles are never evaluation inputs.

New paper announcements request approved-host enrichment before evaluation. A completed insufficient-evidence decision is permanently deleted and cannot enqueue another copy of its source. Approved decisions are retained when captured public text changes, with a content-change marker and the original reviewed snapshot. Metadata-only changes also preserve approved assessments without another Gemini call. Transport failures remain queued beyond three attempts. Three invalid-output failures require inspection; the independent 24-hour local review still completes that work. No model-selected URL expands the fetch allowlist.

## Validation and concurrency

Each batch response binds an assessment to a supplied article id. Unknown or duplicate ids reject the whole response. Missing results and per-item validation failures are withheld while independently valid items can be saved. Each evidence quote must occur in **that item's** excerpt, preventing evidence from another batch member from being accepted. A complete STOP response, exact field set, types, enum values, score bounds and length limits are required.

Service-only `ss_reserve_evaluation_batch` uses the same transaction advisory lock for global spacing, rolling/Pacific/month ceilings and input claims. The request ledger counts calls; the claim ledger counts individual input reservations. Both private tables have RLS enabled and no client grants or policies. Historical single-link reservations carry into request accounting; the retired single-link reservation RPC always refuses new calls.

Before saving, the collector rereads the article and checks deletion, content hash and captured source fields. The update is also conditioned on the hash. Another source update cannot receive an assessment of stale text. Deployments, visitors and refreshes neither reset the ledger nor generate evaluations.

## Privacy

Only a fixed engineering mission, recognized public stack/interest vocabulary, numeric topic priorities and collector-fetched public excerpts reach Google. Free-form interests, custom search queries, names, comments, chats and internal topology are excluded. Source instructions are untrusted data. Gemini receives no tools, browsing or workspace access. Free-tier provider data-use terms still apply to the public inputs.

The API key remains a Supabase Edge Function secret, absent from browser assets, GitHub and logs. Structured output and a real quote substantiate relevance against an excerpt; they do not establish benchmark correctness or a complete-page review.

## Administration and activation

The existing workspace uses Apply, 16 requests/day and 496/month. All settings persist in PostgreSQL across redeployments. Independent installations remain Off with zero daily budget until an administrator configures a verified Free-tier API project and `GEMINI_API_KEY` in function secrets.

Health shows request usage, the current Pacific-day count, exact approved/assessed/rejected/insufficient coverage, assistant handoff progress and a separate new-link queue. It also shows missing public extraction, last batch size, token usage, actual model version, error/cooldown and recent Gemini assessments. Counts are dated snapshots. The next opportunity uses the first released rolling request slot, provider day, month and spacing gates. At handoff completion the next available slot was October 12 at 10:48:30 UTC (13:48 Israel time); later activity can change it.

```mermaid
flowchart TD
  Sources["Search and watched sources"] --> Capture["Public extraction and rules"]
  Capture --> Existing{"Existing handoff URL?"}
  Existing -->|Yes| Retain["Retain assistant decision"]
  Existing -->|No| Queue["New-link review queue"]
  Queue --> Reserve["Atomic request budget and claims"]
  Reserve --> Batch["Flash Latest: up to seven links"]
  Batch --> Validate["Per-link identity and evidence"]
  Validate --> Admission{"Useful and supported?"}
  Admission -->|Yes| Feed["Reviewed suggestions"]
  Retain --> Admission
  Admission -->|No| Hold["Withheld or bounded enrichment"]
  Hold --> Queue
  Capture --> Library["Existing saved library"]
```

References: [Google rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [billing](https://ai.google.dev/gemini-api/docs/billing), [architecture](ARCHITECTURE.md), [operations](OPERATIONS.md).

## Recovery and capacity (October 12, 2026)

The authenticated collector accepts `{ "mode": "evaluation" }` for a dedicated invocation. Apply `supabase/hosted/20261012215125_independent_evaluation.sql` after deploying the collector. Collection no longer waits on Gemini; both schedules run every five minutes with the existing Vault secret. Request accounting remains atomic, includes unsuccessful calls, and preserves all historical requests and reviews. No paid fallback, extra key, alternate model, or automatic quota increase is introduced.

Fresh small queues wait up to an hour to fill a request; aged links and watched releases can proceed immediately. Links older than 24 hours precede releases, then FIFO ordering prevents starvation. Timeouts or malformed responses halve the target batch size; fully valid responses grow it by three up to seven. Actual capacity may be below arrivals during an outage or reduced batches. The admin view reports arrivals, reviews, eligible backlog, scheduled retries, validation failures requiring attention, policy exclusions, and oldest pending discovery. Excluded repositories have an eligibility decision and do not occupy model slots; this is distinct from a semantic content review.

The three explicit Mellanox NVIDIA operator watches (Network, NIC Configuration, Maintenance) run hourly, include release candidates, and bypass popularity/release-count thresholds. They still require current active/licensed repository metadata, an active matching watch in the database, a grounded assessment, and the normal feed relevance requirements. Ordinary discovered repositories retain the configured admission thresholds. Rejected reviews are permanently deleted.

A permanent provider outage or sustained arrivals above successful capacity cannot be solved by retries. Monitor observed queue growth and oldest age; the maximum batch arithmetic is not an availability guarantee or an ETA.

Publisher fingerprints skip unchanged watched content before ingestion, refreshing repository health without another job. Core release jobs are prioritized within the existing job-kind rotation; jobs older than 24 hours retain an age priority. This removes a separate ingestion bottleneck without dropping new source content.

## Local evidence review (October 13, Israel time)

`internal_review` runs independently every five minutes without Gemini, an API key, or a model request. It gives every unresolved source a decision after 24 hours from discovery, including provider failures, repository exclusions and missing public inputs. At normal volume the terminal-decision deadline is 24 hours plus one five-minute scheduler interval, subject to service availability. The sweep considers up to 500 records, prioritizes overdue links and followed releases, and commits batches of at most 200. Qualifying direct-source articles and followed releases may receive immediate local decisions. Fresh ambiguous references remain eligible for Gemini within the existing request ceilings.

The dry policy requires a contiguous public-source quote, multiple infrastructure/serving concepts, an explicit action or mechanism, and an implementation or measurement signal. It uses captured public text and repository health, excludes clear hiring/social-collection/navigation and unrelated application-domain material, and distinguishes insufficient evidence from rejection. Useful local decisions have medium confidence, a bounded 55–85 score, facts, policy version and completion path. They do not establish semantic equivalence to an expert/LLM review, independently verify publisher claims, or certify benchmarks. Facts and source excerpts are visible; output is labeled “local evidence rules.” Keywords alone are not enough.

Publisher AI-summary blocks are excluded from mechanism selection; the authored body must supply the evidence. Parsing/transport errors use generic diagnostic classes rather than copying model response fragments into health or quota logs. When a personal review records public corroboration, details link its primary source; that verification applies only to the stated facts, not an entire article's claims.

Collection independently queues bounded public extraction for unresolved excerpts shorter than 1,800 characters, even when Gemini is paused or its quota is exhausted. Existing host/redirect/size restrictions apply. Long excerpts are left alone, and each requested extraction is marked to avoid repetitive fetches. Legacy trailing-slash article aliases reuse the retained identity and its review history.

Completed assistant/policy scores are enforced in the database after refreshes; publisher metadata cannot replace a reviewed rank with a rules score. RSS collection stores one source-wide digest of normalized feed entries. An unchanged feed is not replayed when individual rejected rows are gone; changed feeds are processed normally. The digest is source health/configuration, not a rejected-link identity registry.

Each commit is service-only and checks article identity, deletion, unchanged source hash, captured input, existing review, enums, score ranges, exact evidence and the same feed/repository gates. A racing Gemini result cannot overwrite a completed local review. Approved history remains immutable. Missing public text receives an insufficient-evidence outcome and is permanently deleted with its dependent data. A stale evaluator health write cannot re-save the deleted title or assessment.

arXiv extraction captures the full abstract instead of navigation. Newly ingested paper announcements enqueue one approved-host enrichment job. The personal backlog review retrieved full abstracts where available. Its historical aggregate checkpoint was 133 decisions: 83 useful, 43 rejected and 7 insufficient; later arrivals were reviewed separately. The per-link backlog report has been removed under the owner-directed deletion policy. Zero backlog is a dated state, not a claim that new links cannot arrive.

Apply the internal-review migration, deploy the collector, then apply `supabase/hosted/20261012221955_internal_review_schedule.sql`. It reuses the existing Vault secret and preserves the collector's active/paused state. The local scheduler is independent of Gemini budget, provider cooldown and API failures. No API requests or external model calls are made by the dry reviewer.

## Link state and deletion policy (October 13)

Overdue `article` and `analyze` collection jobs are first moved into canonical article records with their original discovery timestamps and already captured public text. The promotion performs no fetch or model call, skips active leases, and removes the duplicate job payload. An unavailable source then receives insufficient evidence and is deleted by the same strict policy. This closes the pre-ingestion failure path rather than restarting the 24-hour clock.

`ss_articles.review_state` is a stored generated column. Values are `awaiting_input`, `awaiting_evaluation`, `retry_wait`, `needs_attention`, `approved`, and `archived`. The database derives it from source, retry, review and archive metadata; callers cannot set an inconsistent state. `analysis_status` remains a separate indication of analysis provenance. A transient `discarding` value exists only inside the transaction that deletes a rejected row and never remains in committed storage.

Any terminal decision that fails the strict content/repository policy is physically deleted in the same transaction. Cleanup includes article content, all private review snapshots, evaluation claims/legacy per-link attempts, URL-keyed cohort entries, queued job payloads, saved folder entries, notes/replies, feedback, related audit entries, recent comparison snapshots and unshared repository caches. No rejected-link tombstone, URL, title, hash or per-link decision is retained for suppression. Completed collection jobs are also deleted. Only aggregate discard counters and request-level quota accounting remain; deleting a link never refunds model quota.

This replaces the earlier policy of retaining non-selected audit snapshots. Supabase's normal MVCC cleanup reuses freed database space; row deletion does not promise an immediate decrease in allocated disk size or erase provider-managed backups/log retention. Source watches, ETags and source-level baselines remain source configuration, not rejected article records. With no per-link tombstone, a changed source or a later search can rediscover an old rejected link; it must be evaluated again and removed if it still fails policy. Suppressing it forever would require retaining its identity, contrary to the requested storage policy.

## Provider-rejected batch recovery (October 18, 2026)

A seven-item production batch succeeded; a subsequent adaptive ten-item request
returned HTTP 400 and incorrectly put the whole evaluator into a day-long
configuration backoff. The collector now caps batches at seven. Unknown
request-shape, schema-complexity and output-bound failures on multi-item batches
halve the next target and schedule a five-minute retry. Each attempt still
requires the existing atomic reservation and counts against all provider limits.
Bad keys, billing/model errors and rejected single-item requests retain the
conservative configuration backoff. Raw provider echoes are not stored.

The model metadata advertised a 65,536-token output limit and a read-only
countTokens check accepted the ten-item request. Therefore the generic 400 does
not establish an 8,192-token model cap or prove one particular remote constraint.
The smaller bound is an observed compatibility mitigation. Verify it through
normal reserved production review rather than unaccounted generation probes.
