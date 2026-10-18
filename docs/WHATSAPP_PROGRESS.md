# WhatsApp deployment checkpoint

**Ready for owner QR handoff. Resource provisioning is retired.**

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

## Ready for the next session

- Saved state: AWAITING_WHATSAPP_QR; no active lease; owner notification sent.
- [Owner QR instructions](https://github.com/Idoheled/StackSignal/pull/4#issuecomment-6240842512)
  contain secure key retrieval, narrow SSH ingress, fingerprint and the
  service-user login command. Actual security list: **Default Security List for
  stacksignal-whatsapp**.
- VM, private configuration, saved manifest, model and owner SSH key are intact.
  Do not rerun installation to display the QR.
- Resource-claim schedule deleted; control flag false; private dispatch helper
  inert behind the disabled control state; workflow template archived outside GitHub's workflow path.
  Normal CI has no provisioning mode or job.
- Collector, evaluator and internal-review schedules remain active. WhatsApp
  dispatch stays paused. Production UI and main are unchanged.

Next: phone pairing → verify exact group JID → article/release notifications and
confirmed receipts → reconnect/duplicate checks → release review. No actual
WhatsApp delivery is claimed yet.

## Preserved knowledge

The [dormant toolkit](../ops/oci/README.md) documents the complete flow,
dependencies, safety boundaries and explicit recovery process. The
[dated archive](archive/OCI_BOOTSTRAP_2026_10.md) retains implementation history.
These files can merge without enabling capacity polling or VM setup.
