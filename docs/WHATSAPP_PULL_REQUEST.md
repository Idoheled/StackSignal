# Add WhatsApp opt-in and signed Ollama/OpenClaw notifications

Invited members can explicitly opt in to WhatsApp alerts during signup or change their preference in Notification settings. Opted-in members receive a protected group invitation with clear join/leave and phone-visibility guidance. Notifications deep-link to authenticated article details.

Approved content now has a disabled-by-default private outbox that follows the existing review, repository and release-channel policies. It deduplicates events, leases claims, distinguishes queued work from confirmed delivery, and preserves uncertain sends for reconciliation.

The separate dispatcher signs immutable event payloads and verifies signed receipts. The loopback bot listener durably queues events in SQLite, deduplicates webhook retries, uses local-only Ollama for message generation and invokes OpenClaw with a fixed group JID. Recorded timestamps and platform links are added by the server. Interrupted sends pause for reconciliation.

Validation: 86 automated tests, six OCI preflight checks, four provisioning policy checks and both TypeScript checks passed locally. Hosted CI found an asynchronous checkbox timing bug; the fix updates the choice immediately and restores it if persistence fails. The complete browser suite is being rerun in hosted CI.

This remains a draft: Oracle authentication works, but Jerusalem returned OUT_OF_HOST_CAPACITY for both free A1 sizes in all fault domains. The bounded provisioning script checks home region, tenancy-wide usage, free CPU/RAM/storage limits and narrow SSH access. No production migration, VM, pairing or WhatsApp message has occurred.

Before merging: provision/install the host, configure stable HTTPS and secrets, validate OpenClaw configuration, pair WhatsApp, verify actual group delivery and recovery, reconcile/apply the additive production migration with delivery disabled, run all regression checks and prepare the release. Preserve existing accounts, collector scheduling and Gemini quotas.

[Draft PR #4](https://github.com/Idoheled/StackSignal/pull/4); do not merge before host/delivery/browser checks pass.
