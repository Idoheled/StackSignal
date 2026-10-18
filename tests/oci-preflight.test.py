"""Synthetic safety/diagnostic checks; no Oracle credentials or network required."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location(
    "preflight", Path(__file__).resolve().parents[1] / "scripts" / "oci-preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class PreflightTests(unittest.TestCase):
    def test_mutation_never_reaches_subprocess(self):
        with patch.object(subprocess, "run") as run:
            with self.assertRaises(preflight.CheckError):
                preflight.cli(("compute", "instance", "launch"))
            run.assert_not_called()

    def test_failed_cli_does_not_expose_error_credentials(self):
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess(
            [], 1, "", "sensitive-session-token")):
            with self.assertRaises(preflight.CheckError) as error:
                preflight.cli(("iam", "availability-domain", "list"))
            self.assertNotIn("sensitive-session-token", str(error.exception))

    def test_multiple_home_regions_fail(self):
        with self.assertRaises(preflight.CheckError):
            preflight.detect_identity([
                {"region-name": "one", "is-home-region": True},
                {"region-name": "two", "is-home-region": True}], [])

    def test_ad_quota_requires_domain(self):
        with self.assertRaises(preflight.CheckError):
            preflight.quota_check("tenancy", "region", {
                "name": "standard-a1-core-count", "scope-type": "AD"}, lambda *_: {})

    def test_scoped_quota_preserves_domain_and_projects_output(self):
        calls = []

        def run(operation, options):
            calls.append(options)
            return {"available": 2, "used": 0, "unexpected": "private"}

        result = preflight.quota_check("tenancy", "region", {
            "name": "standard-a1-core-count", "scope-type": "AD",
            "availability-domain": "AD-1", "value": 2}, run)
        self.assertIn("--availability-domain", calls[0])
        self.assertEqual(result["availability_domain"], "AD-1")
        self.assertNotIn("unexpected", result)

    def test_partial_quota_failure_remains_unknown_not_zero_or_ready(self):
        def run(operation, options):
            if operation == ("iam", "region-subscription", "list"):
                return [{"region-name": "home", "is-home-region": True}]
            if operation == ("iam", "availability-domain", "list"):
                return [{"name": "AD-1", "compartment-id": "ocid1.tenancy.test"}]
            if operation == ("compute", "shape", "list"):
                return [{"shape": "VM.Standard.A1.Flex"}]
            if operation == ("limits", "value", "list"):
                return [{"name": "standard-a1-core-count", "scope-type": "AD",
                         "availability-domain": "AD-1", "value": 2}]
            raise preflight.CheckError("Availability unsupported.")

        result = preflight.build_report(run)
        self.assertIsNone(result["a1_service_quotas"][0]["available"])
        self.assertEqual(result["resources_created"], 0)
        self.assertNotIn("ready", result)
        self.assertIn("Not checked", result["host_capacity"])
        self.assertIn("Not checked", result["billing"])
        json.dumps(result)


if __name__ == "__main__":
    unittest.main()
