# WhatsApp notification host onboarding

Status: the host, local Ollama/OpenClaw runtime and HTTPS receiver are verified.
Phone pairing, invite-based StackSignal group identity and a real announcement
through OpenClaw are confirmed. Resource provisioning is retired. Automatic
article/release delivery and opt-in UI rollout remain pending, with dispatch
disabled. See the [current checkpoint](WHATSAPP_PROGRESS.md).

No further owner pairing steps are required. The commands below are for
independent installations or explicit future recovery. Do not repeat VM setup,
bootstrap or linking on the working host.

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

## Independent installation: read-only Cloud Shell preflight

The owner supplied an OCI API signing key and account configuration on October
14. Direct SDK authentication works; Cloud Shell is an optional fallback for a
separate installation. Jerusalem is the verified home region. The existing
installation already owns its VM and network. Keys, account configuration and
raw tenant reports remain outside this repository.

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

## Independent provisioning and recovery

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

## Feature branch database and UI

The additive `whatsapp_notification_preferences` migration defaults every member's
choice and global delivery to off. The opt-in invitation wrapper executes the
existing invitation completion and preference update in one database transaction;
the original invitation signature remains available to old clients.

`ss_whatsapp_preferences` requires the existing active-member/session/MFA checks
and updates only `auth.uid()`. The invite is returned only to an opted-in member.
The UI hides it when switched off, explains the separate join/leave steps, and
discloses phone-number visibility. The real group invite must be configured in
the private database table after deployment, not in public source or client assets.

`/?article=<uuid>` opens an authenticated article response containing public
content metadata. Private notes still use the existing permission-filtered path.

The outbox stays in `ss_private`, with RLS and no direct client/service table
grants. Enqueue occurs only for newly qualifying, evidenced content after
activation, respects repository/release-channel policy, and does not backfill
existing approvals. A followed release creates one release event. Article removal
cascades to its event, avoiding discarded per-link payload copies.

Service-only claim/completion RPCs use leases and `SKIP LOCKED`. A queued webhook
result preserves the payload and schedules another check; only a confirmed
provider message ID marks it sent. Successful sends clear the copied text.
Uncertain delivery requires reconciliation before replay. The dispatcher and
receiver are implemented but undeployed, so no event is delivered by this
migration alone.

Do not enable delivery or merge to main until the webhook path, actual WhatsApp
group send, retry/reconnect behavior and production rollout have been verified.

## Direct SDK provisioning

`scripts/oci-host.py` uses the owner's existing API signing configuration. It
does not require an OCI MCP. Its default mode checks the home region, inventory
across active compartments and physical capacity without creating infrastructure:

```sh
python3 scripts/oci-host.py --config /secure/oci/config --state-dir /secure/stacksignal-host
```

Run with the separately installed pinned `oci==2.187.2` SDK. An exit code of 2
means neither free ARM size has capacity; the script stops before networking or
VM creation. It makes one bounded pass, without a background retry or paid
fallback. Credential paths and state must stay outside the checkout.

When capacity is available, the implementer generates a dedicated Ed25519 SSH
key, determines the administrative egress IPv4 address, and supplies its /32 to
the reviewed apply command:

```sh
python3 scripts/oci-host.py --config /secure/oci/config --state-dir /secure/stacksignal-host \
  --apply --ssh-public-key /secure/stacksignal-host/ssh.pub --ssh-cidr ADMIN_IP/32
```

The script creates a tagged VCN, internet gateway, route table, security list,
subnet and one Ubuntu 24.04 ARM VM. Only SSH from the specified network and
HTTP/HTTPS are allowed inbound, plus IPv4 path MTU discovery. Provisioning state
and retry tokens survive interruptions. A subsequent run recognizes an existing
deployment instance instead of allocating another. Quota/account upgrade is not
part of this procedure. Current capacity remains the blocker.

## Host installation and pairing

The implementer places the reviewed checkout at `/opt/stacksignal` and runs
`sudo bash /opt/stacksignal/bot/deploy/install-host.sh` on the fresh ARM VM. The
prepared bootstrap pins Node 24.19.0, OpenClaw/WhatsApp plugin 2026.10.3, Ollama
0.40.4 and Caddy 2.11.7; downloaded runtime archives have recorded SHA-256
checks. It validates the OpenClaw configuration and starts only local Ollama.
These deployment steps run on the allocated ARM host. Consult
`WHATSAPP_PROGRESS.md` for the latest live verification checkpoint.

The `qwen3:4b` model is an initial candidate. Record its installed digest, measure
memory/latency and review generated messages before activation. If it does not
fit the smaller host, select a smaller local model and rerun quality checks;
never use a cloud inference fallback. Keep one model loaded and one generation
in flight. The service explicitly disables Ollama cloud features.

The implementer configures the protected `/etc/stacksignal/bot.env`:

| Name | Value / owner |
| --- | --- |
| `WHATSAPP_WEBHOOK_SECRET` | Implementer-generated 32 random bytes encoded as hex; also set on the dispatcher. |
| `WHATSAPP_APP_ORIGIN` | Exact deployed StackSignal HTTPS origin. |
| `WHATSAPP_GROUP_JID` | Verified destination resolved after pairing; not the invitation token. |
| `OLLAMA_MODEL` | Benchmarked local model name; initially `qwen3:4b`. |

A stable public DNS name must resolve to the VM before Caddy starts. An existing
owned subdomain is preferred; a no-registration fallback is a hostname such as
`stacksignal.PUBLIC_IP.sslip.io`, which resolves to the embedded public IP and
supports per-host HTTPS issuance. This adds an external DNS dependency; verify
resolution and certificate renewal, and update the endpoint if the VM IP changes.
Never substitute a temporary quick tunnel or disable certificate verification.
Set `WHATSAPP_BOT_HOST` in a Caddy systemd environment override, install the
prepared Caddyfile and validate it before starting. Only `/v1/events` and process
health are exposed. OpenClaw admin and Ollama ports stay on loopback.

For pairing, the implementer runs this in the secure SSH terminal:

An alternative phone-only handoff is implemented in `pair-phone.mjs` and the
manual `whatsapp_pairing` maintenance operation. It is owner-only, requires an
exact-SHA short-lived encrypted Actions request, and never schedules provisioning
or creates a VM. The operator requests a code using the installed pinned Baileys
library after its QR-ready event; the owner enters it under **Linked devices →
Link a device → Link with phone number instead**. This is a device-linking code,
not an SMS registration code. The phone and encryption key arrive on private
stdin; only an authenticated encrypted code envelope can enter Actions logs.
Credentials stay in the existing private default account directory. The
gateway is paused during linking and restarted on completion/timeout; incoming
conversations and alert delivery stay disabled. The temporary runner /32 SSH
rule is removed immediately after retrieving the encrypted code. Delete the
short-lived Actions request after the operation. Registered accounts are never
overwritten. The SSH/QR path remains available:

```sh
sudo -u stacksignal -H /bin/sh -c 'cd /var/lib/stacksignal-bot && exec env \
  PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin \
  OPENCLAW_STATE_DIR=/var/lib/stacksignal-bot/openclaw \
  OPENCLAW_CONFIG_PATH=/var/lib/stacksignal-bot/openclaw/openclaw.json \
  /opt/node/bin/openclaw channels login --channel whatsapp'
```

The only required phone action is **WhatsApp → Settings/menu → Linked devices →
Link a device**, then scan the live QR using the intended WhatsApp account.
Confirm that this account is in the destination group. Resolve the group's JID
and confirm its identity before setting the fixed target. Start the gateway,
check connection status and run a clearly labeled setup message to that group.
Inbound DMs and group conversations are disabled; members cannot direct the bot
or run tools. QR pairing cannot be performed through the OCI API.

## Dispatcher configuration and activation

The separate Edge Function uses its built-in Supabase service identity. It does
not send a service-role credential to Oracle. Configure these Edge Function
secrets in the project's secret-management UI/CLI, outside git:

| Name | Value |
| --- | --- |
| `WHATSAPP_WEBHOOK_URL` | Verified public HTTPS endpoint ending exactly `/v1/events`. |
| `WHATSAPP_WEBHOOK_SECRET` | Same implementer-generated hex secret as the VM. |
| `WHATSAPP_DISPATCH_SECRET` | Separate random secret for invoking the dispatcher. |
| `WHATSAPP_APP_ORIGIN` | Same exact production origin used on the VM. |

The connected database/Edge deployment tools are sufficient for migrations and
function deployment. If setting project secrets is unavailable through the
connected tooling, the owner performs only the one-time secret-management UI
handoff with implementer-generated values; no new Gemini key is needed.

Deploy `whatsapp-dispatcher` with `verify_jwt=false`; its separate invocation
secret is mandatory. Store the complete Edge URL as `whatsapp_dispatch_url` and
the separate invocation secret as `whatsapp_dispatch_secret` in Vault, then run
`bot/deploy/prepare-cron.sql`. Its transaction creates the one-minute POST with
`x-whatsapp-dispatch-secret` loaded from Vault and leaves the schedule paused.
Preserve the collector's independent schedules. Reconcile production
migration history before applying the additive schema, leave delivery disabled,
and configure the real invitation only in the private configuration table.

Then verify: a signed synthetic article/release reaches the actual group; a
repeated event does not send twice; only the provider receipt marks it sent;
generation failure retries safely; a lost HTTP reply does not duplicate delivery;
gateway disconnect/restart works; uncertain sends remain paused. Process health
alone is not a WhatsApp connection or delivery check. Record receipts and timings
without publishing group identifiers, key material or pairing-session files.
After all checks pass, set a fresh `active_from`, enable delivery, activate cron,
perform a real newly evaluated link check, and only then complete release/main
rollout. Do not backfill historical approvals.

Run one queue worker per database. Do not copy SQLite or WhatsApp credentials
into concurrently running hosts. Preserve encrypted backups of the SQLite/WAL,
model manifest and paired session outside git. Restarted generation is safe to
retry; a `sending` record becomes `uncertain` and must be reconciled with the
actual group/provider before any manual replay. This intentionally trades
automatic replay of ambiguous sends for duplicate protection.

## Verification

```sh
python3 tests/oci-preflight.test.py
```

Synthetic tests cover read-operation restrictions, secret-safe failures, ambiguous
identity, AD-scoped limits and unavailable quota handling. Direct SDK account
and quota reads passed; current physical ARM capacity is unavailable.

## Provider references

- [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Cloud Shell](https://docs.oracle.com/en-us/iaas/Content/API/Concepts/cloudshellintro.htm)
- [Cloud Shell networking](https://docs.oracle.com/en-us/iaas/Content/API/Concepts/cloudshellintro_topic-Cloud_Shell_Networking.htm)
- [A1 shape query](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/compute/shape/list.html)
- [Limit availability](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/limits/resource-availability/get.html)
- [OpenClaw WhatsApp](https://docs.openclaw.ai/channels/whatsapp)
- [OpenClaw message CLI](https://docs.openclaw.ai/cli/message)
- [Ollama generation API](https://docs.ollama.com/api/generate)
- [Ollama local-only settings](https://docs.ollama.com/faq)
- [Caddy HTTPS](https://caddyserver.com/docs/automatic-https)
- [sslip.io DNS and TLS](https://sslip.io/)
