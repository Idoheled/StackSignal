# Incident review: October 20–21, 2026

## Evidence and findings

Investigation used the owner-provided StackSignal group alerts, private incident
and delivery ledgers, current queue state, pg_cron records and provider Edge logs.
No WhatsApp conversation history or personal chats were accessed.

| UTC interval | Finding | Evidence / limit |
| --- | --- | --- |
| Oct 20 16:01–18:26 | Collection backlog exceeded the 30-minute threshold, then drained | Incident `374b05c5-4974-4030-9b5b-ff15445aa59a`; opening alert: 68 pending / 56 overdue |
| Oct 20 17:46–18:01 | One watch reported an error, then succeeded | Incident `a24723d5-88bb-42df-9ff4-109344ce8de0`; source identity/error were overwritten before investigation and cannot be reconstructed |
| Oct 21 00:31–00:51 | Another collection burst aged past the threshold, then drained | Incident `119885b9-2cec-453e-b1b2-70e5ab47ed3e`; opening alert: 33 pending / 11 overdue |
| Oct 21 01:26 onward | One terminal collection failure | Job `46622a08-6f74-4249-84f5-48a2688f981d`; Hugging Face papers search/listing page exceeded the 2 MB fetch ceiling after four attempts |

At 04:57 UTC: 2 collection jobs pending, none overdue; 1 terminal failure;
88 active watches, none overdue/errored; 71 confirmed new-content deliveries,
zero pending, uncertain or missing eligible notifications. Evaluation had 181
pending links, none past its 25-hour threshold, and was waiting on the existing
16-request rolling-day ceiling. The fallback review heartbeat was current.
Gemini had also returned transient HTTP 503 errors; these consumed real reserved
requests. Its quota ledger must not be reset to hide this condition.

All four cron triggers succeeded in the inspected October 20–21 window.
Recorded Edge HTTP responses were 200 (Oct 20: collector 826, dispatcher 1,402,
context 1,437; Oct 21 00:00–05:00: 166, 278 and 300 respectively). Collector maximum
recorded duration was 94.1 seconds on October 20. A successful invocation alone
does not prove every contained job succeeded. Provider function logs contained
boot/shutdown entries, without the source-level error that had already cleared.

The old collector processed at most 8 jobs per five-minute tick: 96 jobs/hour.
This limit can prolong discovery bursts beyond the alert threshold. It is a
contributing capacity constraint, not proof of the exact workload mix during
these past incidents; completed jobs had been deleted without diagnostic spans.

## Corrections

- Increase the fair, leased collection batch ceiling to 32, retaining the
  85-second work admission budget, fetch size/time limits and upstream quotas.
  The budget now includes setup time. Unstarted leases are released without
  consuming an attempt. This is a maximum, not a throughput guarantee.
- Exclude the Hugging Face papers listing/search destination before fetching;
  individual paper pages remain eligible. Preserve the confirmed failed job's
  ID and resolution before removal. Never increase size limits to accept an
  unbounded listing page or mark it evaluated.
- Recovery events use current healthy stage details and a recovered label.
  Preserve opening, latest failing and recovery evidence independently.
- Classify provider HTTP 5xx as provider unavailability, rather than the
  misleading fallback label `invalid_request`. Retry/quota policy is preserved.
- Add private bounded metrics, run records and transition traces, with admin
  historical search. No old observations are fabricated.

## Execution log

- Inspected current main `e5f103bf6211fc152af080a0308d878bd84afbe8` and dev
  `b74567f741af01aae880c70d5fd66e7205b8fd48` before editing; restored a fresh
  checkout because the previous transient workspace was no longer present.
- Confirmed live cron schedules and collector v33 / dispatcher v2 / context v4.
- Created `fix/durable-platform-diagnostics` from dev. Production pairing,
  group isolation, activation cutoff and resource-claim shutdown remain intact.
- Added migration using `supabase migration new durable_pipeline_diagnostics`.
- Local validation passed: 130 application/database/bot tests, both TypeScript
  projects, all six Python deployment guard suites and the new diagnostics
  component lint check. CI browser/build verification and production rollout
  follow; deployment evidence is appended only after actual execution.

## Rollout verification

- PR [#28](https://github.com/Idoheled/StackSignal/pull/28) merged into dev as
  `0b24a81c32086f3d97c964b19951b6a8b4bbc98c`. Quality run
  [39548248008](https://github.com/Idoheled/StackSignal/actions/runs/39548248008)
  passed all 130 tests, the build/security boundary and 42 browser checks.
  Desktop and mobile dashboard screenshots were inspected.
- Applied `durable_pipeline_diagnostics` to hosted Supabase. The repository
  migration filename follows the actual hosted migration version
  `20261021051721`; its SQL is unchanged from the tested CLI-generated file.
- Collector v34 and dispatcher v3 are active; context remains v4. Bot/VM
  credentials, installed boundary adapter, pairing and runtime were not modified.
- Archived the one failed non-content listing job with resolution
  `Policy exclusion: search/listing destination; no article or notification created`.
  Its diagnostic removal event retains `source_size_limit` and its original job ID.
- Three authenticated live verification requests completed at 05:18 UTC:
  collection `c0108811-f927-493a-85a2-8d1d4ac24158` (773 ms), evaluation
  `b29e8e08-8640-43e4-81d4-47eb208100df` (1,360 ms), local review
  `8da17c5e-a80d-4c7b-9bf6-64da1228736c` (1,380 ms). All HTTP 200, no timeout.
  Evaluation correctly waited on its existing quota; no quota reset occurred.
- At 05:19 UTC the scheduled-processing stage was healthy; collection had no
  failed or overdue jobs. The existing incident resolved at 05:18 with the current
  summary: `1 pending; 0 overdue; 0 unresolved failed jobs.` Delivery confirmation
  and final production release are recorded in the release PR/deployment checks.
