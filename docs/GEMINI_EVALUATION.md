# Durable reviewed discovery

StackSignal uses Tavily, public GitHub discovery and source watches to find links. The existing October 11 collection was reviewed by the assistant. Gemini **evaluates newly discovered URLs using public material captured by the collector**; it is not the search engine or an independent fact checker.

## Existing collection and handoff

The handoff froze 717 existing URLs, including URLs in pending collection jobs, at `2026-10-11T17:06:30.77093Z`. All 717 received assistant decisions: 336 useful, 272 not selected and 109 insufficient evidence. These are dated counts, not a promise that every reference is useful or accessible. Public excerpts, repository metadata/README text and release bodies supplied the evidence. GPU benchmarks and third-party code were not executed as part of the relevance review.

The database excludes this cohort at both Gemini candidate selection and atomic reservation. GitHub owner/repository casing does not create a new identity; release-tag casing is preserved. Old queued jobs and redeployments cannot send these links back to Gemini. A genuinely new release URL is eligible. No historical import is reapplied, and no provider quota ledger is reset.

Service-only `ss_apply_assistant_reviews` validates explicit decisions, exact source evidence and every acceptance gate before storing a reviewer/date and reviewed-content snapshot. An immutable private review-history table retains the decision. Collector refreshes preserve completed reviews; changed public text is flagged against the original snapshot. Reviewed or cohort articles are excluded from routine 90-day cleanup. Existing bookmarks, notes, feedback and read states remain attached to their original article IDs.

## What members see

GitHub links must first pass the [current repository maintenance policy](REPOSITORY_DISCOVERY.md). The same gate is enforced at candidate selection, atomic reservation and feed read. This does not certify code security or peer review.

Every suggested-feed mode, including releases and All reviewed, admits only completed, useful assessments with medium/high confidence, practical/advanced depth, an exact source quote and an AI score meeting the administrator's minimum score. Pending links, low-confidence judgments, introductory/tangential results, insufficient evidence and errors stay out of suggestions. Saved library links remain accessible, including references members saved before this policy. Library titles and notes are not submitted to Google.

This week retains the publisher's seven-day date window. New to radar uses the assessment date, so a backlogged or undated reference can surface when its review completes without inventing a publication date. All reviewed has no age cutoff. Followed-release alerts and unread counts require review too, and respect prerelease settings.

Every discovery mode shows at most one latest approved, channel-eligible release per project. The database selects it before search, personal read/dismiss state, score sorting or pagination; weekly and unread-release counts use the same selection. Older maintenance-branch patches cannot displace a newer comparable version just because their score or publication date is higher. Nonversion tag schemes use publisher time. GitHub repository casing and legacy source labels do not split canonical project identity; official OpenShift streams share one project and honor preview opt-in, including in All reviewed. Documentation and PRs remain independent items.

An older release saved by any member remains in the shared library with its review and read state. Saving does not put superseded releases back in discovery. Existing review history and collection rows are retained, and pending/rejected new versions cannot replace the latest approved release. See [discovery selection rules](DISCOVERY.md#5-what-each-person-sees).

Apply mode uses the existing 70% AI / 30% rules blend for high-confidence Gemini assessments; medium-confidence assessments preserve stored rules scores. Admission uses the assessment decision and score independently, so useful unfamiliar tools can enter despite weak keyword overlap. Assistant reviews display and rank by their explicit assessment score. Cards identify the assistant or Gemini as reviewer; details retain the review date and flag subsequent content changes. Evaluate without changing ranking still gates suggestions; Off pauses new evaluations but retains completed reviews.

## Request and coverage budgets

| Control | Enforcement |
| --- | --- |
| Model | `gemini-flash-latest`; last resolved model recorded in Health |
| Batch size | Up to five links in one synchronous `generateContent` request |
| Daily requests | At most 16 in a rolling 24 hours **and** the Pacific calendar day |
| Monthly requests | At most 496 per UTC calendar month; administrator may lower it |
| Spacing | At least five minutes globally, one request per collector tick |
| Public source input | At most 6,000 UTF-8 bytes of text and 500 bytes of title per link |
| Output | 900 generation tokens per link, at most 4,500 per request; LOW thinking |
| Timeout | 30 seconds; no immediate provider retries |
| Input retries | At most three reservations for an unchanged article/context/input; six-hour lease |
| Provider errors | HTTP 5xx: 15-minute global cooldown; quota/auth/other HTTP errors: 24 hours; failures consume slots |
| Malformed batch | One-hour global cooldown; affected inputs wait at least six hours |

The owner's October 11, 2026 AI Studio screenshots show **5 RPM, 250,000 input TPM and 20 RPD** for Gemini 3.8 Flash on a Free-tier project. Sixteen daily requests leave four requests of daily headroom. These quotas are shared by every client in the Google project and can change when the latest alias changes. Keep the project dedicated to StackSignal and on the Free tier. Application ceilings cannot prove or control the project's billing tier. There is no paid fallback or alternate-model retry.

**Sixteen requests × five links gives an upper bound of 80 link assessments/day, not a throughput guarantee.** Small/failed batches, insufficient excerpts, unavailable sources and arrivals above capacity can cause delays. A monthly request ceiling is an application safeguard, not a Google monthly free allowance. Do not claim exhaustive discovery or instant review regardless of volume.

## Durable queue and extraction

The sweep loads the oldest 50 eligible new-link public inputs **after excluding the frozen cohort and filtering GitHub repository health**, rotates preference among strong/borderline/exploration lanes and submits up to five atomically reserved inputs. Already leased inputs are skipped within the window, so an interrupted request does not unnecessarily block all other work. There is no seven-day queue expiry.

New references without public text enter a separate bounded extraction queue: up to eight records per tick, once per record, only for approved public hosts. Completed assistant reviews skip this bootstrap extraction. PDFs and unsupported hosts remain visible in administrator new-link coverage as missing public input. Public GitHub repository extraction uses API metadata and a bounded public README when available. Imported chat text, private notes and arbitrary user titles are never evaluation inputs.

A new-link insufficient-evidence search snippet may request one richer approved-host fetch. Completed decisions are retained when captured public text changes, with a content-change marker and the original reviewed snapshot. Metadata-only changes also preserve the assessment without another Gemini call. Failed unchanged inputs receive bounded delayed retries; after three reservations they remain withheld for inspection. No model-selected URL expands the fetch allowlist.

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
  Reserve --> Batch["Flash Latest: up to five links"]
  Batch --> Validate["Per-link identity and evidence"]
  Validate --> Admission{"Useful and supported?"}
  Admission -->|Yes| Feed["Reviewed suggestions"]
  Retain --> Admission
  Admission -->|No| Hold["Withheld or bounded enrichment"]
  Hold --> Queue
  Capture --> Library["Existing saved library"]
```

References: [Google rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [structured output](https://ai.google.dev/gemini-api/docs/structured-output), [billing](https://ai.google.dev/gemini-api/docs/billing), [architecture](ARCHITECTURE.md), [operations](OPERATIONS.md).
