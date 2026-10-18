# WhatsApp rollout checkpoint

**Paired, fixed group configured, and real article/release delivery verified.
The owner approved the private UI and authorized production promotion.
Production dispatch remains paused until Columbus passes live verification.
Resource provisioning is retired. No further phone pairing is needed.**

## Verified delivery — October 18, 2026

- The owner received the real announcement from
  [activation run 39107509714](https://github.com/Idoheled/StackSignal/actions/runs/39107509714).
- [Readiness run 39109432899](https://github.com/Idoheled/StackSignal/actions/runs/39109432899)
  re-verified the supplied invite, exact StackSignal group and linked account,
  set the fixed destination without overwriting credentials and checked all four
  services and the connected WhatsApp gateway.
- Two explicitly labeled real tests used existing reviewed public articles and
  valid platform links. The GitHub release was confirmed at 08:00:12 UTC and
  the article at 08:01:37 UTC through the deployed dispatcher, signed HTTPS
  receiver, durable queue, local Ollama and actual OpenClaw adapter. Both private
  outbox records are Sent, have provider IDs, zero webhook failures and cleared
  payloads. Existing articles/reviews were not modified.
- Signed event replay returned the same provider receipts; unsigned events were
  rejected with 401. [Restart run 39109941531](https://github.com/Idoheled/StackSignal/actions/runs/39109941531)
  rechecked membership, restarted the gateway/receiver, found the same fixed
  target, two durable confirmed deliveries and all four healthy services.
  Replaying after restart returned those same receipts.
- Each maintenance run removed its temporary /32 SSH ingress. The encrypted
  request secret is removed after the operation. No private phone, invite,
  group ID or raw provider response is committed.

The manual tests kept cron paused and temporarily used a future admission
watermark to block ordinary collection from creating alerts. Global enablement
was restored to false and its watermark to the original null value afterward.
No historical backfill or unreviewed content was broadcast. Source-trigger,
policy, failure/retry and uncertain-send cases are covered by migration/runtime
regressions; the live tests verify the deployed delivery path and persistence.

## Registration and repository

The additive registration migration is applied. The owner, Eilon and Roi are
administrator-confirmed Registered, per the owner's explicit group-membership
confirmation. Other users' preferences are preserved. Signup is optional;
Pending users see the invite after login and explicitly confirm joining.
Unregistering records the change and explains how to leave the actual group.
See [registration](WHATSAPP_REGISTRATION.md).

The repository now has protected `main`, protected `dev`, and the active feature
branch. Superseded dependency PRs #1–#3 were closed and their temporary branches
removed; their diffs and history remain on GitHub. They contained only package
and lockfile proposals. Feature PR #4 targets `dev`; only main can deploy the
public app. [Branch conventions](BRANCHING.md) explain the integration/release
path. The approved private preview remains owner-only; production promotion
follows the new Columbus verification gate.

## Existing host and retired provisioning

The [October 17 bootstrap](https://github.com/Idoheled/StackSignal/actions/runs/39067999141)
installed the existing Jerusalem A1 VM (2 OCPU, 12 GB RAM, one 50 GB boot disk),
using runtime source `36600a5dd1f328144e356b51fa7c3c8a4833af5f`.
Ollama, OpenClaw, receiver and Caddy passed active checks; qwen3:4b generated a
real formatted alert in 70.7 seconds. Pairing and later maintenance preserve that
installed runtime and private state. Maintenance helpers are copied separately.

Provisioner status `AWAITING_WHATSAPP_QR` is its historical stop boundary, not
current WhatsApp status. The protected manifest now records pairing, group,
delivery and restart verification. Control remains false with no active lease;
there are zero resource-claim cron jobs. The private dispatch helper is inert.
Its workflow template is outside GitHub's workflow directory and CI has no
provisioning mode. The [dormant toolkit](../ops/oci/README.md) and
[historical archive](archive/OCI_BOOTSTRAP_2026_10.md) preserve the proven setup.
Never rerun installation, reset the manifest or relink the working account.

Collector, evaluator and internal-review schedules remain active and unchanged.
The pending operational gate is the production notification release:
verify Columbus, promote the reviewed release to main, run the
guarded activation transaction with a fresh watermark and verify the first
newly admitted production event. [Operations](WHATSAPP_SETUP.md) documents
activation, pausing and recovery.

## Columbus and daily-pipeline repair — October 18

The new-content trigger is applied as migration `20261018084521`. It admits only
new discoveries on their first useful review after activation, excluding old
pending links and reevaluations. Local tests include exact-group filtering
before message handling, fixed outbound targets, English/Hebrew prefixes,
no-tools Ollama prompts, trusted article context and restart deduplication.

The first Columbus maintenance attempts failed to reconnect and rolled back;
their green workflow status means an encrypted report was produced, not a
successful rollout. Private startup diagnostics identified unreadable plugin
source after a root-owned replacement. The installer now preserves service
ownership and keeps adapter imports inside the managed package capture boundary.
Live retesting is required before activation; paired credentials are retained.

The scheduled internal reviewer was blocked by evidence slicing through a
UTF-16 surrogate pair. Unicode-safe contiguous slicing restored actual HTTP
success and processed 563 pending links, including 154 useful approvals. These
historical approvals were not broadcast. Discovery recorded 37 new links over
the preceding 24 hours. Gemini completed a real repaired REST request at 09:19:18 UTC using the resolved
`gemini-3.8-flash` model. One result passed validation; another was withheld for
invalid evidence, preserving the admission gate. Collector version 32 contains
the clean repair; temporary provider diagnostics were removed. Existing request
quotas and pacing remain enforced. Do not infer provider success from a green
scheduler invocation.
