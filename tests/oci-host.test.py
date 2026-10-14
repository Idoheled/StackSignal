import importlib.util
from pathlib import Path
import unittest
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("host", Path(__file__).resolve().parents[1] / "scripts/oci-host.py")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class FreeHostPolicy(unittest.TestCase):
    def test_region_and_existing_compute_fail_closed(self):
        with self.assertRaises(host.HostError):
            host.free_guard("other", "home", [], [])
        with self.assertRaises(host.HostError):
            host.free_guard("home", "home", [{"state": "RUNNING", "shape": "VM.Standard.A1.Flex"}], [])

    def test_storage_counts_boot_and_block_before_launch(self):
        self.assertEqual(host.free_guard("home", "home", [], [{"state": "AVAILABLE", "size": 150}]), [])
        with self.assertRaises(host.HostError):
            host.free_guard("home", "home", [], [{"state": "AVAILABLE", "size": 151}])

    def test_resume_does_not_allocate_another_host_or_boot_disk(self):
        instance = {"state": "PROVISIONING", "shape": host.SHAPE, "ocpus": 2, "memory": 12, "deployment": "same"}
        self.assertEqual(host.free_guard("home", "home", [instance], [{"state": "AVAILABLE", "size": 200}], "same"), [instance])
        with self.assertRaises(host.HostError):
            host.free_guard("home", "home", [instance, instance.copy()], [], "same")
        for changes in [{"ocpus": 4}, {"memory": 24}, {"shape": "VM.Standard.E5.Flex"}]:
            with self.assertRaises(host.HostError):
                host.free_guard("home", "home", [{**instance, **changes}], [], "same")

    def test_ssh_exposure_is_explicit_and_narrow(self):
        self.assertEqual(host.ssh_rule("198.51.100.8/32"), "198.51.100.8/32")
        for value in ["0.0.0.0/0", "10.0.0.0/8", "::/0"]:
            with self.assertRaises(host.HostError):
                host.ssh_rule(value)

    def test_saved_launch_cannot_expand_cost_or_change_identity(self):
        request = {"availability_domain":"AD-1","fault_domain":None,"ocpus":2,"memory_gb":12,
            "image_id":"ocid1.image.oc1.il-jerusalem-1.example","subnet_id":"subnet","ssh_public_key":"dedicated"}
        host.validate_launch(request,["AD-1"],"subnet","dedicated")
        for changed in ({"ocpus":4},{"memory_gb":24},{"availability_domain":"other"},
                        {"subnet_id":"other"},{"ssh_public_key":"other"},{"fault_domain":"unknown"},
                        {"image_id":"ocid1.image.oc1.other.example"}):
            with self.assertRaises(host.HostError):
                host.validate_launch({**request,**changed},["AD-1"],"subnet","dedicated")

    def test_async_network_wait_is_bounded_and_stops_when_fence_is_lost(self):
        events=[];clock=[0]
        def sleep(seconds):clock[0]+=seconds
        def read(identifier):
            events.append("read:"+identifier)
            return SimpleNamespace(data=SimpleNamespace(id=identifier,lifecycle_state="AVAILABLE"))
        value=SimpleNamespace(id="saved",lifecycle_state="PROVISIONING")
        ready=host.wait_available(value,read,lambda:events.append("fence"),sleep,lambda:clock[0])
        self.assertEqual(ready.lifecycle_state,"AVAILABLE")
        self.assertEqual(events,["fence","read:saved"])
        def lost():raise host.HostError("Lease lost")
        with self.assertRaisesRegex(host.HostError,"Lease lost"):
            host.wait_available(value,lambda _:self.fail("Lost fence must prevent API calls"),lost,sleep,lambda:clock[0])
        with self.assertRaisesRegex(host.HostError,"not yet available"):
            host.wait_available(value,lambda _:SimpleNamespace(data=value),lambda:None,sleep,lambda:clock[0])
        self.assertLessEqual(clock[0],122)


if __name__ == "__main__":
    unittest.main()
