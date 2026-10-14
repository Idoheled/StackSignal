# WhatsApp notification implementation progress

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
browser-verified.

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
