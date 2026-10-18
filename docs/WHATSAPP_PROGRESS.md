# WhatsApp deployment checkpoint

**Paired; verified StackSignal group; manual announcement confirmed.
Automatic curated alerts remain disabled. Resource provisioning is retired.**

On October 18 at 07:26 UTC (10:26 Israel), [the activation
run](https://github.com/Idoheled/StackSignal/actions/runs/39107509714) connected
using the paired identity, resolved the supplied invite, verified the exact
StackSignal group and membership, restarted the gateway and sent one
announcement through the production OpenClaw transport. Its provider message ID
and private destination evidence are saved in the protected manifest and host
announcement ledger. No phone number, group identifier, invite or code is
committed here. Maintenance source `6658b52` passed hosted CI, including
recipient-identity and confirmed/uncertain-send replay tests. The temporary SSH
rule and Actions request secret were removed. No further owner pairing steps
are required.

## Verified host baseline — October 17

On October 17, 2026 at 20:50 UTC (23:50 Israel),
[the successful bootstrap](https://github.com/Idoheled/StackSignal/actions/runs/39067999141)
finished on the existing Jerusalem A1 ARM VM: 2 OCPU, 12 GB RAM, 50 GB boot disk,
public IP `82.70.223.24`. Setup retries created no replacement VM.

Verified runtime source: `36600a5dd1f328144e356b51fa7c3c8a4833af5f`.
Ollama, OpenClaw, receiver and Caddy passed active checks. Local-only qwen3:4b
generated a real formatted alert in 70,743 ms. Public HTTPS health returned 200
with ok true and delivery_enabled false. Hosted verification passed 94 Node
tests, 27 Python safety checks, 36 browser tests, both TypeScript checks, build
and boundary/release checks before the final bootstrap.

## Current operating state

- Provisioner state AWAITING_WHATSAPP_QR is its historical stop boundary, not
  current WhatsApp status. Private `manifest.whatsapp` records paired,
  group-verified and announcement-sent evidence; there is no active lease.
- [Owner SSH/QR recovery instructions](https://github.com/Idoheled/StackSignal/pull/4#issuecomment-6240842512)
  contain secure key retrieval, narrow SSH ingress, fingerprint and the
  service-user login command. Actual security list: **Default Security List for
  stacksignal-whatsapp**.
- VM, private configuration, saved manifest, model and owner SSH key are intact.
  Do not rerun installation or relink the working account.
- Resource-claim schedule deleted; control flag false; private dispatch helper
  inert behind the disabled control state; workflow template archived outside GitHub's workflow path.
  Normal CI has no provisioning mode or job.
- Collector, evaluator and internal-review schedules remain active. WhatsApp
  dispatch stays paused. Production UI and main are unchanged.

Next: configure the verified fixed group for queued delivery → article/release
webhook-to-group tests and receipts → reconnect/duplicate checks → enable
new-event dispatch → release the opt-in UI. The manual announcement is confirmed;
automatic content delivery is not yet claimed.

## Preserved knowledge

The [dormant toolkit](../ops/oci/README.md) documents the complete flow,
dependencies, safety boundaries and explicit recovery process. The
[dated archive](archive/OCI_BOOTSTRAP_2026_10.md) retains implementation history.
These files can merge without enabling capacity polling or VM setup.
