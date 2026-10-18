import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location("pair_runner",Path(__file__).resolve().parents[1]/"scripts/whatsapp-pairing-runner.py")
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)

class PairingGuards(unittest.TestCase):
    def test_only_exact_fresh_request_and_idle_recorded_host_are_accepted(self):
        now=1800000000000;sha="a"*40
        request=dict(sha=sha,phone="15555550123",key="ab"*32,session="00000000-0000-4000-8000-000000000001",expires_at=now+600000)
        runner.validate_request(request,sha,now)
        for change in ({"sha":"b"*40},{"expires_at":now},{"phone":"+15555550123"},{"session":"invalid"},{"key":"short"},{"operation":"provision"}):
            with self.assertRaises(RuntimeError):runner.validate_request({**request,**change},sha,now)
        state=dict(status="AWAITING_WHATSAPP_QR",cron_enabled=False,lease_id=None,instance_ocid="one",manifest={"instance":"one"})
        runner.validate_host(state)
        for change in ({"cron_enabled":True},{"status":"VM_ALLOCATED_INSTALLING"},{"lease_id":"active"},{"manifest":{"instance":"two"}}):
            with self.assertRaises(RuntimeError):runner.validate_host({**state,**change})

if __name__=="__main__":unittest.main()
