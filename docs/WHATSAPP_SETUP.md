# WhatsApp notification host onboarding

Status: preparation only. WhatsApp delivery, UI preferences, notification outbox,
and the Oracle VM are not deployed. Existing Cloudflare/Supabase services remain
unchanged. See [progress](WHATSAPP_PROGRESS.md).

## Decisions

- Run OpenClaw and local Ollama on a new Oracle Always Free ARM VM. Notification
  generation must not consume the existing Gemini evaluation project's quota.
- The owner has created an OCI account and destination WhatsApp group. Keep the
  real group invite link out of this public repository and public build assets.
- Target `VM.Standard.A1.Flex`, 2 OCPUs, 12 GB RAM. Oracle's current Always Free
  allowance is 1,500 OCPU-hours and 9,000 GB-hours per month across A1 VMs in the
  tenancy. Check account usage, storage and console eligibility before launch.
- Service quota is not physical host capacity or a billing entitlement. Never
  upgrade the account or fall back to paid shapes to recover a failed launch.
- Notifications use a shared stream. Turning a website preference off does not
  remove a WhatsApp group member; the planned first version explains how to leave.

## First handoff: read-only Cloud Shell check

1. Sign in at <https://cloud.oracle.com/>. Select the tenancy's home region.
2. Open **Developer tools / Cloud Shell** from the top bar. Wait for the terminal.
3. For downloads, use the terminal's **Network** menu and select **Public Network**
   if available. OCI Service Network can run OCI reads but cannot fetch GitHub.
   If Public Network is unavailable, download `scripts/oci-preflight.py` from the
   feature branch using your browser, then use Cloud Shell's **Upload** action.
   Do not change tenancy policies or create a paid gateway for this check.
4. Download the exact reviewed revision of `scripts/oci-preflight.py`, then run:

   ```sh
   python3 /tmp/stacksignal-oci-preflight.py
   ```

   If uploaded instead, run `python3` with the uploaded filename/path.
5. Return the JSON output to the implementer. It projects region, non-secret
   tenancy/domain IDs, A1 service limits and usage; it excludes credentials.

This script only lists/gets OCI metadata, with bounded requests and no CLI debug
logging. It uses Cloud Shell's pre-authenticated CLI. It creates no resource and
does not read credential files. A failed availability query is recorded as
unknown. Unsupported limits may require a manual console check.

Also choose whether OpenClaw should pair to an existing personal WhatsApp account
or an existing dedicated account. A phone number, password, API signing key or
WhatsApp verification code is not needed in this handoff.

## Subsequent handoffs

After the live report, prepare the exact provisioning configuration, verify
Always Free eligibility and storage usage, and launch the VM through an
authenticated OCI connection or an owner-run reviewed Cloud Shell script.
Prepare SSH access with a dedicated key; return only the public IP/resource
identifiers. Do not paste the owner's private keys into chat.

After OpenClaw is installed, expose the live QR in the owner's secure setup
session. The owner uses **WhatsApp > Linked devices > Link a device**. Scanning
links the chosen WhatsApp identity; no Meta API key is needed for this transport.
Resolve and restrict the group destination after pairing, then run delivery
tests before activation. WhatsApp Web transport can disconnect or require
re-pairing; a successful webhook response is not proof of a WhatsApp send.

Keep Ollama bound privately. Select and pin a model after measuring ARM memory,
generation latency and output quality. No paid inference fallback is authorized.

## Verification

```sh
python3 tests/oci-preflight.test.py
```

Synthetic tests cover read-operation restrictions, secret-safe failures, ambiguous
identity, AD-scoped limits and unavailable quota handling. Live quota/permissions
checks remain pending until the owner runs the script in the OCI tenancy.

## Provider references

- [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Cloud Shell](https://docs.oracle.com/en-us/iaas/Content/API/Concepts/cloudshellintro.htm)
- [Cloud Shell networking](https://docs.oracle.com/en-us/iaas/Content/API/Concepts/cloudshellintro_topic-Cloud_Shell_Networking.htm)
- [A1 shape query](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/compute/shape/list.html)
- [Limit availability](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/limits/resource-availability/get.html)
- [OpenClaw WhatsApp](https://docs.openclaw.ai/channels/whatsapp)
