# Oracle provisioning — retired from automatic operation

The VM completed bootstrap on October 17, 2026 and is now paired, with a verified group announcement.
There is **no resource-claim schedule**, no OCI job/input in normal CI.
The retained private dispatch helper returns without sending HTTP in the disabled
QR-ready state. The preserved template is outside
`.github/workflows`, so GitHub cannot execute it. Merging these files does not
reactivate provisioning.

Use the [current checkpoint](WHATSAPP_PROGRESS.md) and
[QR handoff guide](WHATSAPP_SETUP.md) for the running host. Protected state,
resource identities and owner SSH credentials are preserved. Delivery stays
disabled until pairing and verified group receipts.

The [dormant toolkit runbook](../ops/oci/README.md) contains the complete
architecture, source map, lessons and explicit recovery requirements. Its
[historical archive](archive/OCI_BOOTSTRAP_2026_10.md) records the investigation.
Old checkpoints are not instructions to repeat setup.

Owner-only retirement checks in Supabase SQL Editor:

```sql
select status, cron_enabled, lease_id, instance_ocid, public_ip,
       manifest->'ready' as ready
from public.oci_provisioner_state;
select jobname, schedule, active from cron.job order by jobid;
select ss_private.oci_hourly_dispatch();
```

Expected: AWAITING_WHATSAPP_QR, false, no lease, original instance/readiness
evidence; no stacksignal-oci-hourly-claim row; null dispatcher result (no request enqueued).
Collector/evaluator/internal-review stay active, WhatsApp dispatch stays paused.
