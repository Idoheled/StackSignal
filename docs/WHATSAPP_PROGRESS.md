# WhatsApp rollout checkpoint

**Columbus receives fresh phone-originated questions, confirmed by the owner.
The v0.3.2 correction keeps identity answers grounded, removes unrelated article
context and uses the audited English-first language policy.** Administration's
empty-queue fix shipped in v0.3.1. The owner authorized production promotion.
Runtime and frontend deployment identities live in the private checkpoint;
historical test receipts below do not replace a fresh signed health check.

## October 19 (Israel) — Administration and receive-path follow-up

The Administration render crash occurred when an empty job queue produced SQL
`jobs: null`. Both pending/failed counters now handle that aggregate. Mobile and
desktop tests use the real null shape, assert no uncaught page errors, and
navigate Dashboard and Health & audit. Production v0.3.1 passed
[release and security checks](https://github.com/Idoheled/StackSignal/actions/runs/39141657586).

Runtime [39142135808](https://github.com/Idoheled/StackSignal/actions/runs/39142135808)
verified exact capabilities replies, English/Hebrew final-only generations,
seven signed catalog rows and preserved pairing/restart. The capabilities
answer is deterministic and accepts leading mobile RTL direction marks.
Signed aggregate receive counters separate wire frames from local upserts;
they showed only the local canary at this checkpoint. No phone-originated reply
is claimed from that test.

The guarded receive update preserves Baileys's metadata-only ignored-packet
acknowledgement and records every blocked frame. Personal ciphertext remains
blocked before receive handlers; chat sends remain fixed to StackSignal. The owner subsequently confirmed both capabilities and generated identity
replies from the phone; the identity reply exposed a separate answer-quality
problem. Release promotion requires the answer-quality and restart gates below. See [health operations](PLATFORM_HEALTH.md) for the protocol and
diagnostic boundaries. Private state is the current deployment checkpoint.

The read-only [synthetic quality audit](https://github.com/Idoheled/StackSignal/actions/runs/39169268450)
sent no group messages. With article context removed, the installed 4B model
still denied its identity in Hebrew and produced a confused Hebrew RDMA/TCP
explanation. English samples were coherent. The correction therefore adopts
English-first replies with a maintained Hebrew notice for both Hebrew aliases,
maintained identity answers, strict structured output and context only when an
article is explicitly referenced. The [guarded runtime check](https://github.com/Idoheled/StackSignal/actions/runs/39170009675)
records real English model answers about Kubernetes scheduling and RDMA/TCP,
Hebrew identity/language routing, signed catalog lookup and pairing-preserving
restart. Its synthetic answers are reviewed in the encrypted owner report;
no group test messages are sent. Source runtime:
`b3a0181cce62da64ed9624b1c72d01253c541079`.

[Source CI](https://github.com/Idoheled/StackSignal/actions/runs/39169721779)
passed 126 application/bot tests and 42 browser checks across three engines.
The `dev` → `main` release PR is [#23](https://github.com/Idoheled/StackSignal/pull/23);
its merged commit must pass Quality, production smoke and Release before the
frontend version is considered published.

Production v0.2.0 passed [main rollout and security smoke checks](https://github.com/Idoheled/StackSignal/actions/runs/39115889435).
Alerts were enabled at **2026-10-18 09:38:15.509511 UTC (12:38:15 Israel)**. The
09:39 scheduled dispatch returned actual HTTP 200 with zero queued/sent/retry/
uncertain events. Historical receipts stayed unchanged. Both discovery and
first useful evaluation must follow the cutoff.

Current alert state remains controlled by the private database configuration
and named dispatch cron. Future release operators must verify live state; a
historical document or the allocator status is not a health check.

## Verified delivery — October 18, 2026

| Verification | Evidence |
| --- | --- |
| Owner received group announcement | [Run 39107509714](https://github.com/Idoheled/StackSignal/actions/runs/39107509714) |
| Exact invite/group/account and fixed target | [Run 39109432899](https://github.com/Idoheled/StackSignal/actions/runs/39109432899) |
| Actual article and release alerts | Provider-confirmed at 08:00:12 and 08:01:37 UTC; both private outbox rows Sent, payloads cleared, zero webhook failures |
| Replay, unsigned rejection and restart | Same provider IDs on signed replay, HTTP 401 unsigned; [restart run 39109941531](https://github.com/Idoheled/StackSignal/actions/runs/39109941531) |
| Columbus English and Hebrew questions | Two real automatic replies with provider IDs, followed by successful gateway/receiver restart; [run 39114540914](https://github.com/Idoheled/StackSignal/actions/runs/39114540914) |
| Runtime and boundaries | Source `dc68999b9adc0479be2987e2f39d9292aedae72b`; group-only, no personal chats/history/tools, paired credentials preserved, all four services active |

The Columbus adapter's reviewed SHA-256 is
`a42d497461b6c588e9b2806e57ccffb2fd29a5a41e9e6d5b38018d15fad6750f`.
Private provider receipts remain in the protected ledgers. Temporary /32 SSH
rules and short-lived Actions requests are removed after maintenance.

Manual alert tests used two already-reviewed public articles without changing
their reviews. They kept cron paused and used a temporary future admission
watermark, then restored the original disabled state. They were explicitly
labeled tests, not historical backfill. Routine alerts require both new
discovery and first evaluation after activation. Reevaluations are excluded.

## Registration and release

Migration `20261018074942` is applied. The three explicitly requested accounts
were confirmed privately in the database. Account identities and registration
records are not part of the public runbook. Other preferences are preserved. Optional signup and settings record Pending, provide the group
invite and require confirmation; unregistering explains how to leave the actual
group. See [registration](WHATSAPP_REGISTRATION.md).

The approved private preview is owner-only. Integration PR #4 targets `dev`;
release promotion uses `dev` → `main` and only main deploys production.
[Branch conventions](BRANCHING.md) explain protection, PR merges and temporary
branch deletion. Dependency proposals #1–#3 were closed and their branches
removed; their package-only diffs remain in GitHub history.

The live new-content migration is `20261018084521`. Activation requires the
recorded delivery and Columbus checkpoints, no provisioning lease, reconciled
outbox, passing CI and verified production rollout. Use
[activate-notifications.sql](../bot/deploy/activate-notifications.sql).
[Operations](WHATSAPP_SETUP.md) covers pausing, recovery and the pinned adapter.

## Daily discovery and review

The 10:45 UTC follow-up found a first-review notification defect: the collector
stores JSON `evaluation: null`, which the trigger's JSON extraction incorrectly
treated as an existing review. The additive `whatsapp_null_first_evaluation`
migration uses text extraction to recognize both missing and JSON-null pending
evaluations. Database regressions cover first delivery, metadata refreshes and
existing-review suppression even without an outbox row. It performs no backfill
or reevaluation and preserves the original activation cutoff and paired host.

At 09:20 UTC, 88 watches were active, collection had just stored a fresh link,
37 retained links were newly discovered over the preceding 24 hours and 156 had
recent review timestamps. Collector/evaluator/internal-review jobs run every
five minutes independently of site visits.

Unicode-safe evidence slicing repaired a blocked internal-review batch,
processing 563 pending inputs including 154 useful approvals. Historical
approvals were not broadcast. The Gemini REST schema repair completed a real
request at 09:19:18 UTC against resolved `gemini-3.8-flash`; one result passed,
while another failed evidence validation and remained withheld. Clean collector
version 32 is deployed; temporary provider diagnostics were removed. Quotas,
reservations and five-minute pacing remain enforced. Provider outages or quota
windows can delay evaluation; inspect actual HTTP results and authorized health.

## Existing host and retired provisioning

The [October 17 bootstrap](https://github.com/Idoheled/StackSignal/actions/runs/39067999141)
created the Jerusalem A1 host: 2 OCPU, 12 GB RAM, one 50 GB boot volume. Columbus
updates preserve that VM, paired state and delivery receipts. No re-pairing or
new VM is needed.

`AWAITING_WHATSAPP_QR` is the allocator's historical stop boundary, not current
WhatsApp status. Its manifest records pairing, group, delivery, restart and
Columbus verification. Provisioning control remains false with no active lease
and zero resource-claim cron jobs. The dormant workflow lives outside GitHub's
active workflow directory. [The toolkit](../ops/oci/README.md) and
[archive](archive/OCI_BOOTSTRAP_2026_10.md) preserve recovery knowledge.

## October 18 — platform observability implementation

Added signed read-only catalog replies for recent-release questions, explicit
busy/failure responses, private durable health incidents and an administrator BI
dashboard. Local authorization, delivery-ordering and exact Hebrew-request
regressions pass. Hosted browser, VM canary and production deployment evidence
remain release gates; see [health operations](PLATFORM_HEALTH.md). Existing
pairing, group-only boundary and original no-backfill cutoff are preserved.
