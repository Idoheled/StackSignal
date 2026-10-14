import importlib.util
from pathlib import Path
import unittest

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


if __name__ == "__main__":
    unittest.main()
