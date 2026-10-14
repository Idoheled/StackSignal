# WhatsApp notification implementation progress

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
