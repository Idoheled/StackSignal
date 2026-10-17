import base64
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("runner",Path(__file__).resolve().parents[1]/"scripts/oci-capacity-runner.py")
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)


class ProvisionerBoundary(unittest.TestCase):
    def test_signed_reply_cannot_be_reflected_tampered_or_replayed(self):
        secret="ab"*32;stamp="1791990000";body=b'{"action":"ping","result":{"ok":true}}'
        headers={"x-stacksignal-timestamp":stamp,"x-stacksignal-signature":runner.signature(secret,stamp,body,True)}
        self.assertTrue(runner.verify_response(secret,body,headers,1791990000))
        self.assertFalse(runner.verify_response(secret,body+b" ",headers,1791990000))
        self.assertFalse(runner.verify_response(secret,body,headers,1791990301))
        headers["x-stacksignal-signature"]=runner.signature(secret,stamp,body)
        self.assertFalse(runner.verify_response(secret,body,headers,1791990000))

    def test_console_public_key_identity_rejects_missing_or_ambiguous_keys(self):
        header=b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20"
        raw=header+bytes(range(32));key=b"ssh-ed25519 "+base64.b64encode(raw)
        value,fingerprint=runner.console_host_key(b"boot log\n"+key+b" root@host\n")
        self.assertEqual(value,key.decode())
        self.assertEqual(fingerprint,"SHA256:"+base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("="))
        for console in (b"fingerprint only",key+b"\nssh-ed25519 "+base64.b64encode(header+bytes(reversed(range(32))))):
            with self.assertRaises(runner.RunnerError):runner.console_host_key(console)

    def test_host_identity_reads_beyond_oci_default_console_prefix(self):
        raw=b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20"+bytes(range(32))
        key=b"ssh-ed25519 "+base64.b64encode(raw)
        log=b"early boot output\n"*1000+key+b" root@host\n"
        class Compute:
            def get_console_history_content(self,identifier,offset=0,length=10240):
                self.identifier=identifier
                return SimpleNamespace(data=log[offset:offset+length])
        compute=Compute()
        with self.assertRaises(runner.RunnerError):runner.console_host_key(compute.get_console_history_content("snapshot").data)
        public_key,fingerprint=runner.console_host_identity(compute,"snapshot")
        self.assertEqual(public_key,key.decode())
        self.assertTrue(fingerprint.startswith("SHA256:"))
        self.assertEqual(compute.identifier,"snapshot")

    def test_lost_lease_stops_before_running_host_commands(self):
        heartbeat=runner.Heartbeat(None);heartbeat.lost.set()
        with patch.object(runner.subprocess,"run") as command:
            with self.assertRaises(runner.LeaseLost):runner.run_command(["ssh","host"],heartbeat)
            command.assert_not_called()

    def test_public_ssh_rule_rejects_private_ipv6_and_unspecified_addresses(self):
        self.assertEqual(runner.global_ipv4("8.8.8.8\n"),"8.8.8.8")
        for value in ("10.0.0.1","127.0.0.1","::1","0.0.0.0","2001:4860:4860::8888"):
            with self.assertRaises(runner.RunnerError):runner.global_ipv4(value)


if __name__=="__main__":unittest.main()
