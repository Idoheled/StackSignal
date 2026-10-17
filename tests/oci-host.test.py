import importlib.util
import base64
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("host", Path(__file__).resolve().parents[1] / "scripts/oci-host.py")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class CapacityError(Exception):
    status = 500
    code = "InternalError"
    message = "Out of host capacity."
    opc_request_id = "oracle-request-evidence"


class AllocationSafety(unittest.TestCase):
    def setUp(self):
        output=patch("sys.stdout",new_callable=io.StringIO)
        output.start()
        self.addCleanup(output.stop)
        self.requests = [{"availability_domain":"AD-1","fault_domain":fd,"ocpus":cpu,"memory_gb":ram,
            "image_id":"ocid1.image.oc1.il-jerusalem-1.example","subnet_id":"subnet","ssh_public_key":"dedicated"}
            for fd in (None,"FAULT-DOMAIN-1","FAULT-DOMAIN-2","FAULT-DOMAIN-3") for cpu,ram in host.SIZES]
        self.manifest = {"launch_token":"original"}
        self.snapshots = []

    def save(self):
        self.snapshots.append(copy.deepcopy(self.manifest))

    def run_claim(self, launch, requests=None, save=None, reconcile=lambda:None):
        return host.launch_candidates(self.manifest, self.requests if requests is None else requests,
            launch, save or self.save, reconcile, lambda e:isinstance(e,CapacityError))

    def test_capacity_rejections_try_each_placement_with_durable_new_tokens(self):
        tokens=[]
        def reject(request, token):
            self.assertEqual(self.snapshots[-1]["launch_request"],request)
            self.assertEqual(self.snapshots[-1]["launch_token"],token)
            tokens.append(token)
            raise CapacityError()
        self.assertIsNone(self.run_claim(reject))
        self.assertEqual(len(set(tokens)),8)
        self.assertNotIn("launch_request",self.manifest)
        result=self.manifest["last_launch_result"]
        self.assertEqual(result["status"],"OUT_OF_HOST_CAPACITY")
        self.assertEqual(len(result["attempts"]),8)
        self.assertTrue(all(a["request_id"]=="oracle-request-evidence" for a in result["attempts"]))

    def test_success_stops_after_one_host_and_persists_its_identity(self):
        launch=Mock(return_value=SimpleNamespace(id="only-host"))
        self.assertEqual(self.run_claim(launch).id,"only-host")
        self.assertEqual(launch.call_count,1)
        self.assertEqual(self.snapshots[-1]["instance"],"only-host")

    def test_timeout_rate_limit_and_unknown_server_error_stop_without_rotating_token(self):
        for error in (TimeoutError(),RuntimeError("429"),RuntimeError("unknown 500")):
            self.manifest={"launch_token":"original"}
            launch=Mock(side_effect=error)
            with self.assertRaises(type(error)):
                self.run_claim(launch)
            self.assertEqual(launch.call_count,1)
            self.assertEqual(self.manifest["launch_token"],"original")
            self.assertEqual(self.manifest["launch_request"],self.requests[0])

    def test_uncertain_launch_reuses_original_parameters_and_token(self):
        self.manifest.update(launch_request=self.requests[3],launch_started_at="original-time")
        launch=Mock(return_value=SimpleNamespace(id="reconciled"))
        self.run_claim(launch,[self.requests[3]])
        launch.assert_called_once_with(self.requests[3],"original")
        self.assertEqual(self.manifest["launch_started_at"],"original-time")
        with self.assertRaisesRegex(host.HostError,"cannot change"):
            self.run_claim(Mock(),[self.requests[0]])

    def test_failed_fence_prevents_launch_and_changed_inventory_prevents_next_launch(self):
        launch=Mock(side_effect=CapacityError())
        def lost():raise host.HostError("lease lost")
        with self.assertRaisesRegex(host.HostError,"lease lost"):
            self.run_claim(launch,save=lost)
        launch.assert_not_called()
        self.manifest={"launch_token":"original"}
        reconcile=Mock(side_effect=[None,host.HostError("storage changed")])
        with self.assertRaisesRegex(host.HostError,"storage changed"):
            self.run_claim(launch,reconcile=reconcile)
        self.assertEqual(launch.call_count,1)

    def test_negative_reports_reach_real_sdk_launch_path_in_apply_mode(self):
        """Exercise main with a fake OCI transport, including inventory and network reuse."""
        def response(data):return SimpleNamespace(data=data)
        class Models:
            def __getattr__(self,name):return lambda **kwargs:SimpleNamespace(**kwargs)
        models=Models()
        identity=Mock();compute=Mock();volumes=Mock();network=Mock()
        identity.list_region_subscriptions.return_value=response([SimpleNamespace(region_name="il-jerusalem-1",is_home_region=True,status="READY")])
        identity.list_compartments.return_value=response([])
        identity.list_availability_domains.return_value=response([SimpleNamespace(name="AD-1")])
        identity.list_fault_domains.return_value=response([SimpleNamespace(name="FAULT-DOMAIN-"+str(i)) for i in (1,2,3)])
        compute.list_instances.return_value=response([])
        volumes.list_volumes.return_value=response([]);volumes.list_boot_volumes.return_value=response([])
        compute.create_compute_capacity_report.side_effect=lambda details:response(SimpleNamespace(shape_availabilities=[
            SimpleNamespace(**vars(x),availability_status="OUT_OF_HOST_CAPACITY") for x in details.shape_availabilities]))
        compute.list_images.return_value=response([SimpleNamespace(id="ocid1.image.oc1.il-jerusalem-1.example",display_name="Ubuntu-aarch64",lifecycle_state="AVAILABLE")])
        compute.launch_instance.side_effect=CapacityError()
        tags={"managed_by":"StackSignal","deployment":"saved","deployment_id":"stacksignal-whatsapp-bot-il-jerusalem-1"}
        for plural,label in (("vcns","vcn"),("internet_gateways","gateway"),("route_tables","route"),("security_lists","security"),("subnets","subnet")):
            getattr(network,"list_"+plural).return_value=response([SimpleNamespace(id=label,display_name="stacksignal-whatsapp",lifecycle_state="AVAILABLE",freeform_tags=tags)])
        # OCI default route/security resources inherit the VCN's tags. They are
        # not configured resources and must not be mistaken for our named ones.
        for plural,label,create in (("route_tables","route","create_route_table"),("security_lists","security","create_security_list")):
            getattr(network,"list_"+plural).return_value=response([SimpleNamespace(id="default-"+label,
                display_name="Default "+label+" for stacksignal-whatsapp",lifecycle_state="AVAILABLE",freeform_tags=tags)])
            getattr(network,create).return_value=response(SimpleNamespace(id=label,display_name="stacksignal-whatsapp",lifecycle_state="AVAILABLE",freeform_tags=tags))
        fake=SimpleNamespace(config=SimpleNamespace(from_file=lambda _: {"tenancy":"tenancy","region":"il-jerusalem-1"}),
            retry=SimpleNamespace(NoneRetryStrategy=lambda:None),identity=SimpleNamespace(IdentityClient=lambda *a,**kw:identity),
            core=SimpleNamespace(ComputeClient=lambda *a,**kw:compute,BlockstorageClient=lambda *a,**kw:volumes,
                VirtualNetworkClient=lambda *a,**kw:network,models=models),
            pagination=SimpleNamespace(list_call_get_all_results=lambda call,**kw:call(**{k:v for k,v in kw.items() if k!="retry_strategy"})),
            exceptions=SimpleNamespace(ServiceError=CapacityError))
        with tempfile.TemporaryDirectory() as folder,patch.dict("sys.modules",{"oci":fake}):
            root=Path(folder);(root/"host.json").write_text(json.dumps({"deployment":"saved","launch_token":"original"}))
            (root/"key.pub").write_text("ssh-ed25519 "+base64.b64encode(b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20"+bytes(32)).decode())
            args=["--config",str(root/"config"),"--state-dir",folder,"--ssh-public-key",str(root/"key.pub"),"--ssh-cidr","198.51.100.8/32"]
            self.assertEqual(host.main(args),2)
            compute.launch_instance.assert_not_called()
            self.assertEqual(host.main(args+["--apply"]),2)
            self.assertEqual(compute.launch_instance.call_count,8)
            network.create_route_table.assert_called_once()
            network.create_security_list.assert_called_once()
            self.assertEqual(network.create_route_table.call_args.args[0].route_rules[0].network_entity_id,"gateway")
            self.assertEqual([r.tcp_options.destination_port_range.min for r in
                network.create_security_list.call_args.args[0].ingress_security_rules if r.protocol=="6"],[22,80,443])
            for call in compute.launch_instance.call_args_list:
                details=call.args[0]
                self.assertEqual(details.shape,host.SHAPE)
                self.assertIn((details.shape_config.ocpus,details.shape_config.memory_in_gbs),host.SIZES)
                self.assertEqual(details.source_details.boot_volume_size_in_gbs,50)
                self.assertEqual(details.source_details.boot_volume_vpus_per_gb,10)


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
