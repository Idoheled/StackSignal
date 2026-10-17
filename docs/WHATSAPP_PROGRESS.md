# WhatsApp notification implementation progress

## 2026-10-17 — Resume allocated host after empty RPC response

The allocation run saved the RUNNING host and its public address, then stopped
with `LeaseLost` at the webhook-staging checkpoint. The staging RPC returns
HTTP 204 with no body; the deployed adapter unconditionally parsed JSON and
returned a signed error after both database writes had succeeded. The adapter
now accepts an empty successful response. A regression test runs the actual
deployed adapter/handler across configuration → checkpoint → empty staging RPC,
and verifies the signed HTTP 200 reply. No VM was lost or replaced. The source
also propagates saved allocation evidence into `last_result`. Live control
recovery and same-host bootstrap are being verified before final handoff.

## 2026-10-17 15:32 UTC — ARM host claimed and RUNNING

The immediate [allocation run 39045443557](https://github.com/Idoheled/StackSignal/actions/runs/39045443557)
successfully launched the first reviewed placement at **15:32:32 UTC**: one
`VM.Standard.A1.Flex`, **2 OCPU / 12 GB RAM**, Jerusalem home region. Independent
OCI API reads confirm **RUNNING** and one **AVAILABLE 50 GB** boot volume at
10 VPUs/GB. Public address: `82.70.223.24`. State is
`VM_ALLOCATED_INSTALLING`; the leased runner is continuing SSH verification and
bot bootstrap on the saved instance, not allocating another host.

[Implementation CI 39045182640](https://github.com/Idoheled/StackSignal/actions/runs/39045182640)
passed 90 automated tests, **22 OCI safety checks**, all **36 browser tests**,
types, build, client boundary and release validation before activation.
Runtime setup, local model/TLS checks, cron auto-stop, QR pairing and actual
message receipts are still pending at this checkpoint. Delivery remains off.
The allocation event is now propagated into `last_result`, avoiding stale
capacity-shortage metadata beside a saved instance on subsequent runner saves.

## 2026-10-17 — Allocation audit and direct launch verification

At 15:17 UTC the hourly runner was healthy: recent eight dispatches succeeded,
and Oracle reported no capacity across all eight placements. Independent live
tenancy inventory confirmed zero instances and zero boot/block volumes. State
was `SEARCHING_CAPACITY`, no instance/IP/launch intent, with hourly cron active.
Quality, Production and Release skips were intentional mode/branch conditions.

Audit found that negative capacity reports prevented any `LaunchInstance`
request. The new runner tries the eight reviewed placements directly, prioritizes
positive reports, records provider request IDs and stops at the first allocation.
Definitive capacity rejection rotates the token; uncertain failures preserve
exact parameters/token. Inventory changes or failed durable fencing stop further
requests. Six new safety tests cover the negative-report SDK path, eight bounded
rejections, first-success termination, uncertain response retry, lost fence and
changed inventory. Live activation/allocator results will be recorded after CI.

## 2026-10-14 19:00 UTC — Hourly capacity claimer active and timer-verified

`stacksignal-oci-hourly-claim` is **active** on Supabase cron job 5 with
`17 * * * *` UTC. An actual verification timer fired at 18:59:00 UTC, its
`pg_net` dispatch returned HTTP 200, and
[hosted run 38619792381](https://github.com/Idoheled/StackSignal/actions/runs/38619792381)
completed successfully. The timer's temporary one-shot schedule was restored to
the hourly cadence. The preceding
[manual full-route check](https://github.com/Idoheled/StackSignal/actions/runs/38619594550)
also completed successfully. This is a live external runner, independent of
conversation storage or the Gemini scheduled task.

The latest Oracle check at **18:59:43 UTC** returned `OUT_OF_HOST_CAPACITY` for
2 OCPU/12 GB and 1 OCPU/8 GB in automatic placement and all three Jerusalem
fault domains. State is `SEARCHING_CAPACITY`, provisioning enabled, lease
released, no instance allocated. Four lease acquisitions include one control-only
diagnostic, initial network setup and two actual capacity checks.

Created only the dedicated free VCN, internet gateway, route table, security list
and subnet; all five are AVAILABLE and carry the saved deployment identity.
The prepared network is reused. Asynchronous resource startup now uses a fenced,
bounded wait. No VM, boot disk, paid fallback, WhatsApp pairing or message has
occurred. The dispatcher remains paused and notification configuration disabled.
Existing collector, evaluator and internal-review schedules remain active.

[CI run 38618933131](https://github.com/Idoheled/StackSignal/actions/runs/38618933131)
passed 90 automated tests, 16 OCI safety checks, 36 browser tests, types, build,
client boundary and release checks. Main remains at the v0.1.1 baseline. At the
next successful allocation, the runner resumes this deployment, installs the
bot stack, verifies local inference/TLS and stops its own cron at the owner QR
handoff. The full ARM/WhatsApp delivery gate remains pending capacity and pairing.

## 2026-10-14 — Live scheduler routing and REST lease verification

Hosted [CI run 38609954835](https://github.com/Idoheled/StackSignal/actions/runs/38609954835)
passed 90 automated tests, 15 OCI checks and all 36 browser tests. Supabase
`pg_net` successfully dispatched the feature workflow with HTTP 200 and returned
[runner 38615783181](https://github.com/Idoheled/StackSignal/actions/runs/38615783181).
That run caught a live-only REST safeguard: the control updates lacked explicit
WHERE clauses and were rejected before any OCI operation. Native SQL/PGlite did
not enforce that REST safeguard. Every control update is now scoped to the fixed
deployment, and the correction was applied as an additive temporary migration.
The signed live endpoint is being retested for leases, renewal, checkpoint,
premature-stop rejection and release before another hosted capacity attempt.
The hourly schedule remains paused until that complete attempt is verified.

## 2026-10-14 — Persistent hourly provisioner implementation

Implemented the branch-only hosted runner, atomic fenced leases, durable launch
parameters, signed control/replies and automatic cron stop with owner PR notice.
The existing registered CI workflow dispatches the temporary reusable workflow
on this feature branch, preserving main and its deployment/release conditions.
The runner resumes owned resources, rejects paid configurations and replacement
hosts, verifies SSH identity through the OCI console API, and runs a local model
and TLS readiness check before requesting QR pairing. Partial installs resume.

Applied the additive disabled WhatsApp schema, temporary control schema and
server-only Vault configuration RPCs to the existing Supabase project. Deployed
custom-authenticated `oci-cron-control` and `whatsapp-dispatcher`. Signed live
ping succeeds; unsigned, tampered and stale control requests return 401.
Member count remains six; all opt-ins default false and the outbox is empty.
Delivery remains disabled. Existing collection schedules remain active.

Validation: 90 automated tests, 15 Python OCI safety checks, both TypeScript
checks, standalone build, client asset boundary, release metadata, workflow YAML
and local unpaired HTTP health passed. Hosted CI and the actual scheduler route
must pass before activation. ARM installation, model benchmark, QR pairing and
actual group delivery await physical capacity. Follow [automation operations](OCI_AUTOMATION.md).

This entry supersedes earlier preparation-only snapshots below; main is unchanged.

## 2026-10-14 — GitHub access restored; signed transport implemented

The owner's permission update allowed creation of [draft PR #4](https://github.com/Idoheled/StackSignal/pull/4).
Its first hosted CI run passed types, all database/security tests, the standalone
build and asset checks, then caught a checkbox timing bug across browsers. The
checkbox now updates immediately, disables during saving and restores its
previous value on failure. The suite will rerun on the next feature commit.

Added the signed, bounded webhook dispatcher and signed receipts, a loopback
Node receiver with a persistent SQLite WAL queue, immutable payload deduplication,
local-only Ollama message generation and an OpenClaw group adapter. The adapter's
receipt contract was checked against pinned OpenClaw 2026.10.3 source. Model text
cannot choose the destination, timestamps or UI link. Ollama cloud inference is
disabled in the prepared systemd service; Gemini is untouched.

The queue retries generation failures before sending. Lost webhook responses
replay the same event ID without another send. Interrupted/ambiguous sends pause
for reconciliation. Confirmed provider receipts clear copied content. These are
synthetic transport/recovery checks, not proof of a real WhatsApp group send.

The new OCI SDK script defaults to an inventory/capacity check. Its apply path is
bounded, uses resumable resource tags/idempotency tokens, requires a separate
Ed25519 SSH key and narrow administrative SSH network, and guards home region,
existing compute and the free CPU/RAM/volume envelope. A live run at 15:09 UTC
again returned OUT_OF_HOST_CAPACITY for 2 OCPU/12 GB and 1 OCPU/8 GB in all
Jerusalem fault domains. It created no infrastructure. No background retry has
been scheduled.

Validation so far: 86 automated tests, six preflight checks, four provisioning
policy checks and both TypeScript checks passed. Runtime installation, OpenClaw
configuration validation, ARM model benchmarking, production secrets/HTTPS,
WhatsApp pairing, actual delivery/reconnect checks and rollout remain pending.
Main and production are unchanged.

## 2026-10-14 — Oracle access and notification foundations

The owner supplied an OCI API signing-key pair and configuration. The pair and
fingerprint match; direct SDK authentication succeeded. Home region is
`il-jerusalem-1`; the new account contains no existing compute instances, boot
volumes, block volumes or VCNs. Service limits permit A1, but the live capacity
report at 14:01 UTC returned `OUT_OF_HOST_CAPACITY` for both 2 OCPU/12 GB and
1 OCPU/8 GB across all three fault domains. No infrastructure was created.
Cloud Shell is no longer required for the initial account read. Credentials and
raw tenancy reports remain outside the public source repository.

Implemented on the work branch:

- Invitation checkbox, explicitly unchecked by default, and atomic opt-in signup.
- Notification settings for every member, protected group handoff, join/leave
  guidance and phone-number disclosure.
- Authenticated article deep links without private-note data in the response.
- Additive disabled-by-default preference/configuration schema and private outbox.
- Review/repository/release-policy admission, duplicate-event protection, private
  payload cleanup, leased claims and confirmed-vs-uncertain receipt handling.
- Database/service security regressions and synthetic browser flow checks.

Validation: all 76 automated tests, six OCI preflight safety checks, both
TypeScript checks, standalone build, client asset boundary and release metadata
checks passed. Local browser execution is blocked by unavailable binaries;
downloads returned invalid archives and dependency installation was unsupported.
The three-engine suite must run in hosted CI before this work is considered
browser-verified. The work branch was pushed successfully, but both the supplied
GitHub PAT and connected integration returned 403 when creating a draft PR.
No PR or new hosted CI run was created. Opening the prepared compare page as
the repository owner, or granting Pull Requests write access, is the next CI
handoff; main must remain unchanged.

The Oracle host, webhook dispatcher/receiver and Ollama/OpenClaw delivery are
still pending. No production migration, frontend deployment, WhatsApp pairing
or group message has occurred. Main remains unchanged.

## 2026-10-14 — Initial onboarding preparation

Confirmed with the owner: OCI account exists; no VM/server has been provisioned;
destination WhatsApp group exists; message generation must use local Ollama to
preserve Gemini's evaluation quota. The private group invite is excluded from
this public source repository.

Repository baseline: `5bbe924894d80ddd6e0579bf1d036efcaece160e` (`v0.1.1`).
Work branch: `feat/whatsapp-notifications`. Main remains unchanged.

Completed:

- Checked existing production architecture, onboarding and release boundaries.
- Checked available connectors; no OCI infrastructure provisioning connector
  surfaced. Oracle Analytics is unrelated and is not a substitute.
- Verified current Oracle Cloud Shell and read-only OCI CLI commands against
  official documentation.
- Added a standard-library-only preflight script and synthetic safety checks.
- Documented the exact credential-free first handoff and later QR pairing.

Validation: six synthetic preflight checks, both application/collector TypeScript
checks, all 67 existing automated tests, local setup-guide links and whitespace
checks passed. No live Oracle or WhatsApp test has run.

Pending:

- Owner runs the live preflight; confirm home region, quota, IAM access and billing
  eligibility. Physical ARM host capacity cannot be established by quota reads.
- Confirm which existing WhatsApp identity should be paired.
- Provision and configure a reviewed Always Free VM; prepare recovery/SSH access.
- Implement signup/settings, additive preference/outbox schema, signed webhook
  dispatcher/receiver, durable delivery queue, OpenClaw and Ollama integration.
- Run regression and actual group-delivery checks; only then merge/release.

No VM was created, production database changed, message sent, group joined, or
main deployment triggered by this checkpoint. This is onboarding preparation,
not a working notification feature.
