# Free-plan operations

StackSignal must remain on free service plans. Never enable a paid plan,
pay-as-you-go usage, or a billable fallback to resolve a quota problem. Preserve
articles, evaluations, feedback, saved references and the WhatsApp delivery
ledger. Ask the owner before deleting data or reducing useful collection or
notification frequency.

## Providers and verification

- Supabase shares an organization's egress allowance across its projects.
  Inspect the organization Usage page and each project's breakdown; database
  size is not an egress measurement. Free-plan exhaustion can restrict service
  even without charges.
- Keep Cloudflare Workers and Observability on Free. Verify subscription status
  in the dashboard; the deployed code cannot establish account billing status.
  A deployment token may lack permission to read subscriptions.
- `WRANGLER_WRITE_LOGS=false` controls local deployment-tool logs. It does not
  disable hosted Workers Logs or Observability ingestion.
- Existing Gemini and search request budgets remain independent of hosting
  quotas. Keep their provider accounts free; application request ceilings do
  not prove the provider's billing plan.

## Reducing repeated transfer

The collector previously downloaded the oldest 500 pending article records on
each collection/evaluation pass, then filtered their public excerpts in
JavaScript. Complete excerpts could therefore be transferred repeatedly even
when they did not need enrichment. Provider dashboards are the authoritative
source for billed usage; serialized payload sizes alone are not billing data.

`ss_public_input_candidates()` now applies the same oldest-500 window, 1,800
UTF-16-unit cutoff and first-eight limit inside PostgreSQL. Only selected rows
cross the Data API. The function is read-only, uses the caller's permissions,
and is executable only by `service_role`. The collector keeps its URL checks,
content-hash guards, queue operations and original schedules.

Ignored table-write responses request `return=minimal`. Evaluation's
compare-and-set update explicitly keeps `return=representation`, because the
returned rows establish whether that review won a race. RPC result bodies and
provider quota reservations retain their existing behavior.

The workspace refreshes every minute while visible, and immediately when a
hidden tab becomes visible again. Hidden tabs no longer trigger background
feed, folder, source and statistics requests.

The health monitor and watchdog combine adjacent database requests through
`ss_ops_reconcile_snapshot()`, `ss_ops_observe_claim()` and
`ss_platform_context_limited()`. They retain the existing minute schedules,
authenticated probes, incident leases, signed receipts and rate limit. This
also reduces the API requests that generate provider access logs. Ordinary
second-stage SQL errors return bounded failure markers while preserving the
successful first stage; cancellation still follows PostgreSQL transaction
rollback behavior.

## Rollout and checks

1. Apply the additive `bound_public_input_transfer` and
   `consolidate_operational_requests` migrations before deploying their callers.
   These migrations do not delete or rewrite existing data.
2. Deploy `collector`, `whatsapp-dispatcher` and `platform-context` with their
   existing custom-secret/signature authentication and `verify_jwt=false`.
   Retain existing secrets, dependencies and cron schedules.
3. Deploy the website through the normal verified `main` workflow.
4. Confirm collection/evaluation successes, the new RPC's service-only grants,
   and continued WhatsApp delivery. Verify that old bulk extraction GETs have
   stopped, then compare the next full day's project egress and log ingestion.
5. Recheck the shared organization budget before its billing-cycle reset.

Rollback the changed Edge Functions to their prior versions before removing
their new RPCs. The RPCs can safely remain present if the callers are rolled
back. No restoration of article data is needed because this change does not
delete or rewrite it.

## Cleanup is a separate decision

Operational tables retain metrics for 30 days, traces for 14 days/up to 100,000
events, and run records for 30 days/up to 20,000 records. Any change to these
policies, or a new cron-history retention policy, requires a separate owner
decision. Do not delete article or review history to address egress: removing
stored data does not undo bandwidth already used. Keep account identifiers,
billing screenshots and live usage measurements out of this public repository.
