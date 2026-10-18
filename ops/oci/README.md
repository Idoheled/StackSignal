# Dormant Oracle provisioning toolkit

This directory preserves the proven VM creation and complete bot bootstrap flow.
Nothing here runs automatically. The workflow template is deliberately outside
`.github/workflows`; normal CI has no provisioning job or input. There is no
resource-claim cron. The retained private dispatch helper returns without HTTP
when the control flag is false or the host is QR-ready.

The current host is ready for phone pairing. **Do not restore provisioning for
the QR handoff.** Use [WhatsApp setup](../../docs/WHATSAPP_SETUP.md) and the
[current checkpoint](../../docs/WHATSAPP_PROGRESS.md).

## Preserved implementation

| Source | Responsibility |
| --- | --- |
| [Workflow template](oci-capacity-claim.workflow.yml) | Pinned SDK, encrypted credentials and single-host concurrency. Archived workflow_call definition; not registered with GitHub. |
| [Preflight](../../scripts/oci-preflight.py) | Read-only region, limits, usage and availability inspection. |
| [Host reconciler](../../scripts/oci-host.py) | Free-envelope inventory, owned networking, bounded allocation and durable retry identity. Explicit apply arguments required. |
| [Leased runner](../../scripts/oci-capacity-runner.py) | Signed checkpoints, heartbeat, strict SSH identity, exact source copy, installation, model/TLS verification and stop. |
| [Host deployment](../../bot/deploy/) | Pinned installer, plugin verification, private configuration, systemd services, Caddy and real model benchmark. |
| [Control API](../../supabase/functions/oci-cron-control/) | Retained dormant; QR-ready state refuses new leases. |
| [Historical schema](../../supabase/migrations/20261014170446_oci_capacity_provisioner.sql) | Private control and original dispatcher definition. The subsequent control-guard migration must also be applied. |

No keys, invitation, private configuration or raw tenant responses belong here.
Existing Vault and encrypted Actions credentials remain protected; the owner
administration key is required for the SSH/QR handoff.

## Explicit recovery procedure

Recovery is an operator change, never a result of merging this branch. Do not
reapply the original provisioning migration to an existing database or reset
the recorded instance, deployment UUID or launch token.

1. Reconcile Oracle inventory and owner-only saved state first. Confirm the
   original instance, boot disk, network IDs, fingerprint and readiness evidence.
   Use the existing host. A missing/terminated recorded instance requires a
   separate replacement review; the runner will not silently replace it.
2. Review current eligibility, inventory and pinned runtimes. The proven
   envelope is A1 ARM, 2 OCPU/12 GB or 1 OCPU/8 GB, one 50 GB boot disk,
   no paid shape, NAT gateway or cloud inference fallback.
3. For justified bootstrap recovery, restore the template on a dedicated
   reviewed branch. Add an explicit workflow_dispatch entry point with a
   confirmation input, not a schedule or normal-CI adapter. Deliberately update
   its branch guard. Preserve concurrency, timeouts and encrypted-secret
   contract. Passing CI alone does not authorize provisioning.
4. With **no active lease**, approve that exact tested commit in private control
   state. Reconcile the QR-ready host before any state transition; preserve all
   instance/resource/retry identities. Enabling the control flag is an explicit
   recovery action, never a step for pairing or normal operation.
5. Dispatch once manually and inspect allocation, source-copy, real generation,
   service and TLS evidence. Resources_created 0 is expected on this host.
   Finish with control disabled and temporary SSH ingress removed. Keep delivery
   disabled until pairing and destination tests.
6. Return the repository to this dormant layout. If recurring capacity checks
   are ever separately authorized, review the retained private dispatch helper
   and explicitly add only its named schedule. Do not reapply the state-creation
   migration or alter existing collection jobs.

Retained safety checks:

```sh
python3 tests/oci-preflight.test.py
python3 tests/oci-host.test.py
python3 tests/oci-runner.test.py
node --experimental-transform-types --test tests/oci-provisioner.test.mjs tests/oci-control.test.ts
```

## Lessons from the successful deployment

- Capacity reports are advisory. Prioritize with them, then make bounded
  approved LaunchInstance attempts. All reports were negative immediately before
  the first launch succeeded; capacity can change between calls.
- Persist exact parameters and retry tokens before launch. Only an explicit
  out-of-host-capacity rejection permits another placement/token. Reconcile
  inventory before each request and stop at first success.
- VCN defaults inherit tags. Match names during discovery, then verify saved
  ownership and topology on resume. This host uses **Default Security List for
  stacksignal-whatsapp**.
- Authenticate SSH with the public key from OCI boot console history; read
  beyond its default 10 KiB prefix. Avoid overlapping console captures.
- PostgREST void RPCs return empty HTTP 204 bodies; do not parse those as JSON
  and incorrectly report lease loss after a successful checkpoint.
- Root bootstrap needs standard sbin paths and Git for npm dependencies.
  Service commands need owned working directory, HOME and cache. Use the package
  manager with bounded lock waiting.
- Match the exact OpenClaw version's source-confirmation and plugin-index
  contracts. Verify pinned publisher/version/spec, package paths and provenance.
  Keep inbound conversations and agent tools disabled.
- Stop services before replacing binaries. Wait for Ollama HTTP readiness,
  bound model downloads and benchmark a real formatted alert. Installed binaries
  and a green scheduler run do not prove readiness.
- Signed leases, fixed safe diagnostics and automatic stop protect resumability.
  Phone pairing and actual WhatsApp receipts remain separate gates.

The [dated archive](../../docs/archive/OCI_BOOTSTRAP_2026_10.md) preserves the
detailed investigation and workflow evidence. It is historical, not a task list.
