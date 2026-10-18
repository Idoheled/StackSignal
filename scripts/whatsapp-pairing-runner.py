#!/usr/bin/env python3
"""Explicit manual maintenance of the recorded VM; never provisions resources."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

spec=importlib.util.spec_from_file_location("control_runner",Path(__file__).with_name("oci-capacity-runner.py"))
control_runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(control_runner)
STAGE="request_validation"

def validate_request(request,sha,now=None):
    now=time.time()*1000 if now is None else now
    if (request.get("sha")!=sha or not re.fullmatch(r"[1-9][0-9]{7,14}",request.get("phone",""))
        or request.get("operation","pair") not in ("pair","activation_test","delivery_readiness","columbus_deploy","columbus_diagnostics")
        or request.get("verification_mode") not in (None,"answer_only")
        or not re.fullmatch(r"[0-9a-f]{64}",request.get("key",""))
        or not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",request.get("session",""))
        or not isinstance(request.get("expires_at"),int) or not now<request["expires_at"]<=now+900000):
        raise RuntimeError("Private pairing request is invalid or expired")

def validate_host(state):
    if (state.get("status")!="AWAITING_WHATSAPP_QR" or state.get("cron_enabled") is not False
        or state.get("lease_id") is not None or not state.get("instance_ocid")
        or state.get("manifest",{}).get("instance")!=state.get("instance_ocid")):
        raise RuntimeError("Pair only the idle, recorded QR-ready host")

def main():
    global STAGE
    os.umask(0o077)
    if (os.environ.get("GITHUB_REPOSITORY")!="Idoheled/StackSignal"
        or os.environ.get("GITHUB_REF") not in ("refs/heads/feat/whatsapp-notifications","refs/heads/dev")
        or os.environ.get("GITHUB_ACTOR")!="Idoheled"):
        raise RuntimeError("Owner-only manual integration maintenance")
    sha=os.environ["GITHUB_SHA"]
    request=json.loads(os.environ["WHATSAPP_PAIRING_REQUEST"]);validate_request(request,sha)
    state=control_runner.Control(os.environ["OCI_CRON_CONTROL_SECRET"]).call("status")
    validate_host(state)
    manifest=state["manifest"]
    key,fingerprint=control_runner.console_host_key(manifest["host_public_key"].encode())
    if fingerprint!=manifest["host_fingerprint"]:raise RuntimeError("Host identity changed")
    import oci
    with tempfile.TemporaryDirectory() as temp:
        temp=Path(temp)
        control_runner.private_file(temp/"api.pem",os.environ["OCI_API_PRIVATE_KEY"])
        config={"user":os.environ["OCI_USER"],"tenancy":os.environ["OCI_TENANCY"],
            "fingerprint":os.environ["OCI_FINGERPRINT"],"key_file":str(temp/"api.pem"),"region":"il-jerusalem-1"}
        options={"timeout":(10,20),"retry_strategy":oci.retry.NoneRetryStrategy()}
        STAGE="verify_host"
        compute=oci.core.ComputeClient(config,**options);network=oci.core.VirtualNetworkClient(config,**options)
        instance=compute.get_instance(state["instance_ocid"]).data
        if instance.lifecycle_state!="RUNNING" or instance.shape!="VM.Standard.A1.Flex":raise RuntimeError("Existing host is not running")
        ip=control_runner.runner_ip();public_ip=control_runner.global_ipv4(state["public_ip"])
        response=network.get_security_list(manifest["security"]);security=response.data
        if (security.freeform_tags or {}).get("deployment")!=manifest["deployment"]:raise RuntimeError("Security ownership changed")
        rule=oci.core.models.IngressSecurityRule(protocol="6",source=ip+"/32",source_type="CIDR_BLOCK",is_stateless=False,
            tcp_options=oci.core.models.TcpOptions(destination_port_range=oci.core.models.PortRange(min=22,max=22)))
        def matches(r):
            p=getattr(getattr(r,"tcp_options",None),"destination_port_range",None)
            return r.protocol=="6" and r.source==ip+"/32" and p and p.min==22 and p.max==22
        added=False
        try:
            if any(matches(r) for r in security.ingress_security_rules):raise RuntimeError("Preserve an existing SSH rule")
            network.update_security_list(security.id,oci.core.models.UpdateSecurityListDetails(ingress_security_rules=[*security.ingress_security_rules,rule]),if_match=response.headers.get("etag"));added=True
            control_runner.private_file(temp/"ssh",os.environ["SSH_ADMIN_PRIVATE_KEY"])
            control_runner.private_file(temp/"known_hosts",public_ip+" "+key+"\n")
            ssh_options=["-i",str(temp/"ssh"),"-o","BatchMode=yes","-o","IdentitiesOnly=yes",
                "-o","StrictHostKeyChecking=yes","-o","UserKnownHostsFile="+str(temp/"known_hosts"),
                "-o","ConnectTimeout=10","-o","ServerAliveInterval=20","-o","ServerAliveCountMax=3"]
            ssh=["ssh",*ssh_options,"ubuntu@"+public_ip]
            def run(args,data=None,timeout=120):
                result=subprocess.run(args,input=data,capture_output=True,timeout=timeout)
                if result.returncode:raise RuntimeError("Private host operation failed (exit "+str(result.returncode)+")")
                return result.stdout
            STAGE="connect_ssh"
            for attempt in range(6):
                try:run(ssh+["true"],timeout=20);break
                except RuntimeError:
                    if attempt==5:raise
                    time.sleep(5)
            STAGE="copy_pairing_helper"
            archive=temp/"pairing.tar"
            run(["git","archive","--format=tar","-o",str(archive),sha,"bot","supabase/functions/_shared/whatsapp-protocol.ts"])
            run(["scp",*ssh_options,str(archive),"ubuntu@"+public_ip+":stacksignal-pairing.tar"])
            run(ssh+["sudo install -d -m 0755 /opt/stacksignal-pairing && sudo tar -xf stacksignal-pairing.tar -C /opt/stacksignal-pairing && rm stacksignal-pairing.tar"])
            private={k:request[k] for k in ("phone","key","session","expires_at")}
            if request.get("operation")=="columbus_diagnostics":
                STAGE="read_group_runtime_diagnostics"
                raw=run(ssh+["sudo python3 /opt/stacksignal-pairing/bot/deploy/columbus-diagnostics.py"],json.dumps(private).encode(),timeout=60)
                result=json.loads(raw)
                if result.get("session")!=request["session"] or result.get("status")!="private_result":raise RuntimeError("Invalid private diagnostic result")
                print("MAINTENANCE_ENCRYPTED:"+json.dumps({k:result[k] for k in ("status","session","nonce","encrypted","tag")},separators=(",",":")),flush=True)
                print(json.dumps({"status":"diagnostic_report_ready","provisioning_enabled":False}),flush=True)
                return
            if request.get("operation")=="columbus_deploy":
                STAGE="deploy_group_only_columbus"
                private.update(invite_url=request["invite_url"],group_name=request["group_name"],operation=request["operation"],sha=sha)
                if request.get("verification_mode")=="answer_only":private["verification_mode"]="answer_only"
                raw=run(ssh+["sudo python3 /opt/stacksignal-pairing/bot/deploy/deploy-columbus.py"],json.dumps(private).encode(),timeout=1000)
                result=json.loads(raw)
                if result.get("session")!=request["session"] or result.get("status")!="private_result":raise RuntimeError("Invalid private deployment result")
                print("MAINTENANCE_ENCRYPTED:"+json.dumps({k:result[k] for k in ("status","session","nonce","encrypted","tag")},separators=(",",":")),flush=True)
                if result.get('operation_ok') is not True:raise RuntimeError('Columbus verification incomplete; inspect the encrypted report')
                print(json.dumps({"status":"columbus_verified","provisioning_enabled":False}),flush=True)
                return
            if request.get("operation") in ("activation_test","delivery_readiness"):
                STAGE="verify_group_and_test"
                private.update(invite_url=request["invite_url"],group_name=request["group_name"],operation=request["operation"])
                raw=run(ssh+["sudo python3 /opt/stacksignal-pairing/bot/deploy/activation-test.py"],json.dumps(private).encode(),timeout=360)
                result=json.loads(raw)
                if result.get("session")!=request["session"] or result.get("status")!="private_result":raise RuntimeError("Invalid private activation result")
                print("MAINTENANCE_ENCRYPTED:"+json.dumps({k:result[k] for k in ("status","session","nonce","encrypted","tag")},separators=(",",":")),flush=True)
                print(json.dumps({"status":"activation_report_ready","provisioning_enabled":False}),flush=True)
                return
            STAGE="start_pairing_helper"
            run(ssh+["sudo python3 /opt/stacksignal-pairing/bot/deploy/start-phone-pairing.py"],json.dumps(private).encode(),timeout=90)
            STAGE="wait_pairing_code"
            for _ in range(60):
                raw=run(ssh+["sudo cat /var/lib/stacksignal-bot/pairing/result.json 2>/dev/null || true"],timeout=20)
                if raw:
                    result=json.loads(raw)
                    if result.get("session")!=request["session"]:raise RuntimeError("Pairing session identity changed")
                    if result.get("status")=="code_ready":
                        for field in ("nonce","encrypted","tag"):
                            if not re.fullmatch(r"[A-Za-z0-9+/=]{8,2048}",result.get(field,"")):raise RuntimeError("Invalid encrypted result")
                        print("PAIRING_ENCRYPTED:"+json.dumps({k:result[k] for k in ("status","session","nonce","encrypted","tag")},separators=(",",":")),flush=True)
                        print(json.dumps({"status":"code_ready","phone_logged":False,"provisioning_enabled":False}),flush=True)
                        return
                    safe_stage=result.get("stage")
                    if safe_stage in ("service_context","verify_plugin","load_baileys","load_account","connect","request_code"):
                        print(json.dumps({"status":"pairing_helper_failed","stage":safe_stage}),flush=True)
                    raise RuntimeError("Pairing helper ended")
                time.sleep(2)
            raise RuntimeError("Pairing code was not ready within the bounded wait")
        finally:
            if added:
                response=network.get_security_list(manifest["security"]);security=response.data
                network.update_security_list(security.id,oci.core.models.UpdateSecurityListDetails(
                    ingress_security_rules=[r for r in security.ingress_security_rules if not matches(r)]),if_match=response.headers.get("etag"))
                print(json.dumps({"status":"pairing_ssh_rule_removed"}),flush=True)

if __name__=="__main__":
    try:main()
    except Exception as error:
        # Error messages are fixed operator diagnostics; no request/provider output.
        print(json.dumps({"status":"pairing_incomplete","stage":STAGE,"type":type(error).__name__}),flush=True)
        raise SystemExit(1)
