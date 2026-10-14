# Add WhatsApp opt-in and a private notification outbox

Invited members can explicitly opt in to WhatsApp alerts during signup or change their preference in Notification settings. Opted-in members receive a protected group invitation with clear join/leave and phone-visibility guidance. Notifications deep-link to authenticated article details.

Approved content now has a disabled-by-default private outbox that follows the existing review, repository and release-channel policies. It deduplicates events, leases claims, distinguishes queued work from confirmed delivery, and preserves uncertain sends for reconciliation.

Validation: 76 automated tests, six read-only OCI preflight checks, both TypeScript checks, standalone build, client asset boundary and release metadata checks passed locally. Nine new browser cases join the existing 24 cases; local browser installation was unavailable, so hosted CI must verify all 33.

This remains a draft: the webhook dispatcher/receiver and Ollama/OpenClaw delivery are not implemented or deployed. OCI authentication succeeded, but Jerusalem returned OUT_OF_HOST_CAPACITY for both free A1 sizes in all fault domains. No production migration, main push, VM or WhatsApp message has occurred.

Before merging: complete the host/webhook/LLM transport, pair WhatsApp, verify actual group delivery and recovery, reconcile/apply the additive production migration with delivery disabled, run the complete regression gate, and prepare the release. Preserve the existing account, collector and Gemini quotas.

Prepared compare page: https://github.com/Idoheled/StackSignal/compare/main...feat/whatsapp-notifications?expand=1

Create this as a **draft**; do not merge until the remaining host/delivery/browser checks pass.
