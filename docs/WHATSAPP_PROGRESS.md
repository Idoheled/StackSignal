# WhatsApp notification implementation progress

## 2026-10-14 — Oracle onboarding preparation

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
