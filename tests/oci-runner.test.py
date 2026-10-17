import base64
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

spec=importlib.util.spec_from_file_location("runner",Path(__file__).resolve().parents[1]/"scripts/oci-capacity-runner.py")
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)


class ProvisionerBoundary(unittest.TestCase):
    def test_command_diagnostics_never_copy_remote_secrets_or_unknown_step_values(self):
        secret="private-value-that-must-not-leave-the-host"
        stdout=('arbitrary output '+secret+'\n'+
            json.dumps({"status":"bootstrap_step","step":"openclaw"})+'\n'+
            json.dumps({"status":"bootstrap_step","step":[secret]})+'\n'+
            json.dumps({"status":"bootstrap_step","step":secret})).encode()
        stderr=("npm error spawn git ENOENT\n"+secret).encode()
        result=runner.command_diagnostic(stdout,stderr)
        self.assertEqual(result,{"codes":["ENOENT"],"missing_git":True,"bootstrap_step":"openclaw"})
        self.assertNotIn(secret,json.dumps(result))
        self.assertEqual(runner.command_diagnostic(b'Non-ClawHub npm source requires confirmation '+secret.encode(),b''),
            {"codes":[],"plugin_source_confirmation":True})
        self.assertEqual(runner.command_diagnostic(b'',b'dpkg: error: dpkg frontend lock was locked by another process'),
            {"codes":[],"package_lock":True})

    def network_fixture(self):
        tags={"managed_by":"StackSignal","deployment":"owned"}
        def resource(identifier,**kw):return SimpleNamespace(id=identifier,vcn_id="vcn",freeform_tags=dict(tags),**kw)
        manifest={"deployment":"owned","vcn":"vcn","subnet":"subnet","route":"route","security":"security","gateway":"gateway"}
        subnet=resource("subnet",route_table_id="route",security_list_ids=["security"])
        route=resource("route",route_rules=[])
        ssh=SimpleNamespace(protocol="6",source="198.51.100.8/32",tcp_options=SimpleNamespace(destination_port_range=SimpleNamespace(min=22,max=22)))
        security=resource("security",ingress_security_rules=[ssh])
        gateway=resource("gateway",is_enabled=True)
        network=Mock()
        for name,value in (("subnet",subnet),("route_table",route),("security_list",security),("internet_gateway",gateway)):
            getattr(network,"get_"+name).return_value=SimpleNamespace(data=value)
        network.update_route_table.side_effect=lambda identifier,details:setattr(route,"route_rules",details.route_rules)
        network.update_security_list.side_effect=lambda identifier,details:setattr(security,"ingress_security_rules",details.ingress_security_rules)
        class Models:
            def __getattr__(self,name):return lambda **kw:SimpleNamespace(**kw)
        return manifest,network,Models(),subnet,route,security,gateway

    def test_inherited_default_network_gets_route_and_web_rules_without_broadening_ssh(self):
        manifest,network,models,subnet,route,security,gateway=self.network_fixture()
        fence=Mock()
        with patch("sys.stdout"):
            runner.ensure_network_access(network,models,manifest,"subnet",fence)
        self.assertEqual(route.route_rules[0].destination,"0.0.0.0/0")
        self.assertEqual(route.route_rules[0].network_entity_id,"gateway")
        self.assertEqual([(r.tcp_options.destination_port_range.min,r.source) for r in security.ingress_security_rules],
            [(22,"198.51.100.8/32"),(80,"0.0.0.0/0"),(443,"0.0.0.0/0")])
        self.assertEqual(fence.call_count,2)
        with patch("sys.stdout"):
            runner.ensure_network_access(network,models,manifest,"subnet",fence)
        self.assertEqual(network.update_route_table.call_count,1)
        self.assertEqual(network.update_security_list.call_count,1)

    def test_network_repair_rejects_changed_topology_ownership_and_default_gateway(self):
        for change in ("subnet","ownership","gateway"):
            manifest,network,models,subnet,route,security,gateway=self.network_fixture()
            if change=="subnet":subnet.security_list_ids=["unrelated"]
            if change=="ownership":route.freeform_tags["deployment"]="someone-else"
            if change=="gateway":route.route_rules=[SimpleNamespace(destination="0.0.0.0/0",network_entity_id="unrelated")]
            with self.assertRaises(runner.NetworkIdentityError):
                runner.ensure_network_access(network,models,manifest,"subnet",lambda:None)
            network.update_route_table.assert_not_called();network.update_security_list.assert_not_called()

    def test_network_repair_stops_before_mutation_when_fence_is_lost(self):
        manifest,network,models,*_=self.network_fixture()
        def lost():raise runner.LeaseLost("lost")
        with self.assertRaises(runner.LeaseLost):runner.ensure_network_access(network,models,manifest,"subnet",lost)
        network.update_route_table.assert_not_called();network.update_security_list.assert_not_called()

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
