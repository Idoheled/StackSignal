# Temporary Oracle capacity automation

This deployment lives on `feat/whatsapp-notifications` and must be removed before
the WhatsApp feature merges. Production UI delivery is a separate release gate.

Supabase `pg_cron` calls `ss_private.oci_hourly_dispatch()` at **17 minutes past
every UTC hour**. It reads its GitHub token from Vault and dispatches the existing
`ci.yml` workflow with the feature ref and `mode=oci_capacity`. The feature
version calls `oci-capacity-claim.yml`; quality, Cloudflare deployment and release
jobs do not run for this mode. Using the registered CI entry point avoids the
default-branch registration requirement for a new dispatch workflow.

The signed `oci-cron-control` Edge function grants a 20-minute renewable lease
only to `approved_sha`. GitHub also serializes runners without cancelling them.
Changing branch HEAD requires passing CI and updating the approved SHA before
another run may touch Oracle. Every resource and exact launch request is saved
before the next mutation. Uncertain launches retain their retry token; after
23 hours without reconciliation they pause for owner review. A recorded or
terminated instance is never automatically replaced.

Capacity reports prioritize the eight reviewed placements: both approved sizes,
automatic fault placement and fault domains 1–3. Even if all reports are negative,
the runner sends bounded `LaunchInstance` requests. Only OCI's explicit HTTP 500
`Out of host capacity` rejection permits moving to another placement with a new
token. Timeouts, rate limits and other uncertain errors stop that run and retain
the original parameters/token. Inventory is reconciled before each request;
unexpected compute or storage changes stop further launches. Success stops the
loop immediately. Logs and `last_result.attempts` record provider status and
request IDs; a green check alone does not mean a VM exists.

Only home-region A1, Ubuntu 24.04 ARM, 2 OCPU/12 GB or 1 OCPU/8 GB, and a 50 GB
balanced boot volume are allowed. Tenancy compute/storage inventory is reviewed
on every run. Free networking is prepared once, with no NAT gateway or paid
fallback. SSH accepts only the current runner's public IPv4 /32. The boot
console API supplies the trusted SSH host public key; SSH requires that key.
Only HTTPS/HTTP are public. Ollama, OpenClaw and the webhook process bind locally.
Oracle's default route/security resources inherit VCN tags. Fresh selection also
requires the intended resource name; resumes use exact saved IDs. Before SSH,
the runner validates the saved network topology and reconciles the internet
route and web rules, including legacy default resources. Ownership, gateway or
subnet changes stop setup before a network mutation.

The runner installs pinned runtimes, validates OpenClaw, generates a real alert
with local Qwen3 and checks public TLS health. It benchmarks `qwen3:4b` first and
may select `qwen3:1.7b` if the CPU-only host cannot complete the generation check.
Alerts and the WhatsApp dispatcher cron remain disabled throughout setup.
Once all checks pass, the signed stop action atomically disables provisioning,
unschedules only `stacksignal-oci-hourly-claim`, and posts owner QR instructions
on PR #4. The runner's SSH rule is removed. The owner must add their own /32,
retrieve their private administration key from Vault, verify the published SSH
fingerprint and scan the live QR. No credentials or invite URL are in this repo.

## Status and recovery

Run as the project owner in Supabase SQL Editor; members cannot access this state:

```sql
select status, cron_enabled, approved_sha, attempt_count, last_run_at,
       locked_until, last_result, instance_ocid, public_ip, notification_status
from public.oci_provisioner_state;
select jobname, schedule, active from cron.job order by jobid;
```

To pause immediately without deleting a host:

```sql
begin;
update public.oci_provisioner_state set cron_enabled=false;
select cron.alter_job(jobid, active:=false)
from cron.job where jobname='stacksignal-oci-hourly-claim';
commit;
```

Do not clear `instance_ocid`, resource tags, the deployment UUID, launch intent or
retry token to recover a failure. Reconcile Oracle inventory first. A transient
failure releases the lease and retries the same deployment next hour. A cost,
identity or IAM failure pauses and unschedules provisioning, then tags the owner
on PR #4. GitHub logs contain bounded status/stage metadata, never remote output
or keys. Review the run before authorizing a new `approved_sha`.

## Release cleanup

After QR pairing, verify the intended `@g.us` destination, an article and a release
message, confirmed receipts, duplicate/reconnect recovery and regression CI.
Before merging: remove this document, the temporary workflow, CI mode/job,
`oci-capacity-runner.py`, its tests, `oci-cron-control`, its shared helper/tests,
and the temporary capacity migration source. Remove the deployed control
function, temporary cron/RPC/table and provisioning-only Vault/Actions secrets.
Keep the actual bot, private WhatsApp configuration, owner SSH recovery and
disabled dispatcher until its explicit delivery rollout passes. Never remove
the existing collector, evaluator or internal-review schedules.
