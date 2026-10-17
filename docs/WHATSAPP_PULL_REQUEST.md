# Add WhatsApp opt-in and signed Ollama/OpenClaw notifications

Invited members can explicitly opt in to WhatsApp alerts during signup or change their preference in Notification settings. Opted-in members receive a protected group invitation with clear join/leave and phone-visibility guidance. Notifications deep-link to authenticated article details.

Approved content now has a disabled-by-default private outbox that follows the existing review, repository and release-channel policies. It deduplicates events, leases claims, distinguishes queued work from confirmed delivery, and preserves uncertain sends for reconciliation.

The separate dispatcher signs immutable event payloads and verifies signed receipts. The loopback bot listener durably queues events in SQLite, deduplicates webhook retries, uses local-only Ollama for message generation and invokes OpenClaw with a fixed group JID. Recorded timestamps and platform links are added by the server. Interrupted sends pause for reconciliation.

Temporary hourly provisioning runs on GitHub Actions, dispatched by Supabase cron on this feature branch. A signed control endpoint fences renewable leases, persists exact resource/launch state, resumes the same host and automatically unschedules capacity checks at the QR handoff. The runner checks the free envelope, authenticates the SSH host through Oracle console history, installs pinned runtimes, and verifies local model generation and public HTTPS. Private credentials are in Vault and encrypted Actions secrets; the bot has no Supabase service key.

Validation: 90 automated tests, 22 OCI safety checks, 36 browser tests, both TypeScript checks, standalone build, asset boundary and release checks passed in hosted CI. Live control checks cover signatures, leases, renewal, checkpoint, release and premature-stop rejection. Production RPC grants deny members access to provisioning state and credentials.

The hourly job at `17 * * * *` UTC was verified through 70 successful timer ticks. Direct allocation now tries bounded approved placements even when reports are negative, preserves uncertain retry tokens and stops at the first success. [Run 39045443557](https://github.com/Idoheled/StackSignal/actions/runs/39045443557) claimed a 2 OCPU / 12 GB A1 host at 15:32 UTC on October 17. Independent OCI reads confirm RUNNING and one 50 GB boot volume. Bootstrap is continuing on that saved instance; the provisioner stops itself after model/TLS verification at the QR handoff.

This remains a draft: the additive notification schema and dispatcher are staged with delivery disabled. The six member profiles, bookmarks, folders and feedback are preserved, and existing collection schedules are active. Installation, QR pairing and real group receipts are release gates; no actual WhatsApp message is claimed by synthetic checks.

Before merging: pair the allocated host, verify article/release delivery and recovery, remove all temporary provisioning workflow/control/cron source and credentials, run regression checks and prepare the release. Preserve accounts, existing collector schedules and Gemini quotas. Operational status and checkpoints are recorded in [WhatsApp progress](WHATSAPP_PROGRESS.md) and [temporary automation operations](OCI_AUTOMATION.md).

[Draft PR #4](https://github.com/Idoheled/StackSignal/pull/4); do not merge before host/delivery/browser checks pass.
