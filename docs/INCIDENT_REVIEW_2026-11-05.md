# November 5, 2026 pipeline incident

## Findings

- At 00:45 Israel time, local review completed normally. The 00:50 tick ran,
  and both the overdue-job promotion and candidate RPCs returned HTTP 200.
  The review commit RPC returned HTTP 400. PostgreSQL recorded
  `Evidence is not grounded in the public input`. The collector recorded 265
  consecutive failed local sweeps by 22:50 Israel time. Collection and
  evaluator scheduling continued. The two 01:12 WhatsApp alerts describe
  the same failed local stage from the heartbeat and scheduler views.
- A fresh NVIDIA publisher excerpt contained an “AI-Generated Summary”
  section. Removing that section joined nonadjacent text; the local
  reviewer then selected a quote spanning the seam. The database correctly
  rejected it because the original captured text did not contain that quote.
  One rejected item rolled back the entire batch and was retried on every
  five-minute sweep. Replaying the same input after the fix produced a
  contiguous, 82-character quote and preserved its useful decision.
- Gemini separately recorded nine upstream-unavailable responses and
  three timeouts in 24 hours. Its cooldown protected the request budget,
  but the broken local fallback left reviews to age past their deadline.
  At investigation start, 271 eligible reviews were pending, including
  150 more than 25 hours old.
- Collection retried one automatic Tavily result pointing to unavailable
  NVIDIA NIM documentation four times. The last HTTP 404, at 03:25 Israel
  time, exhausted the lease's retry budget. Its unresolved failed job
  triggered the 03:31 alert. The candidate had no saved references, notes,
  feedback, committed review or notification.

## Prevention and recovery

- Treat removed publisher summaries as evidence boundaries. Validate each
  selected quote against the captured original before sending it to SQL.
  Keep the database's grounding, policy, freshness and hash checks.
- Commit at most 50 reviews in one transaction. Bisect only recognized
  row validation failures, with a fixed split limit and sweep deadline.
  Valid sibling batches finish; rejected rows remain unchanged and visible
  for diagnosis. Database outages fail the run instead of being retried
  in a loop. Optional statistics cannot prevent a completed review sweep
  from recording its heartbeat.
- Merge independent evaluator and local-review health patches atomically.
  Late provider failures and extraction bookkeeping cannot overwrite an
  already evaluated row. Scheduled run diagnostics include a fixed,
  redacted failure classification and database operation name.
- After two consecutive article-fetch 404s or a definitive 410, atomically
  archive only the matching leased job and soft-archive its exact unused,
  unreviewed Tavily search result. Keep manual, annotated, saved, reviewed,
  watched and claimed work outside that path. Preserve a trace and send
  no content notification for the archived item. Transient fetch errors
  retain their existing retry and alert paths.
- An explicit authenticated submission can restore this specific archive.
  A matching new collection job has up to 15 minutes to capture fresh
  evidence before normal fallback review resumes. Keep the original
  discovery time, useful publisher evidence and prior archive trail.
- Keep the configured Gemini pacing, cooldown, Pacific-day and rolling
  quotas. Provider and publisher failures can recur; the safeguards isolate
  them from unrelated valid work and surface remaining overdue reviews.

## Verification

The regression suite exercises exact quote grounding across a removed
summary, one invalid row among valid peers, deadline and outage behavior,
health merge and redaction, provider/fallback races, service-only access,
lease matching, and terminal collection disposition without notification.

The hosted migration `20261105211125_resilient_review_pipeline` applied
before collector v35 and WhatsApp dispatcher v4. The platform-context
function and OCI runtime did not change. At 23:13 Israel time, one
authenticated local sweep returned HTTP 200, committed 18 reviews and
reported no rejected or deferred rows. The exact former blocker was
approved with the verified original-text quote. The snapshot showed
75 pending reviews, zero overdue reviews and zero failed collection jobs.
The unavailable job was archived with its trace. See the release PR for
subsequent scheduled-run, delivery and deployment evidence.
