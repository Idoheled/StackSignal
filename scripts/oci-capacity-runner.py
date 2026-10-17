#!/usr/bin/env python3
"""TEMPORARY: leased, resumable OCI claimer, run only on the reviewed feature SHA.

Secrets enter via encrypted Actions environment and remain outside the checkout.
Capacity absence is success. Delivery remains disabled until owner QR handoff.
"""
import base64
from datetime import datetime, timezone
import hashlib
import hmac
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

REGION = "il-jerusalem-1"
DEPLOYMENT = "stacksignal-whatsapp-bot-il-jerusalem-1"
CONTROL_URL = "https://plbjscbpvfozqvexmqhk.supabase.co/functions/v1/oci-cron-control"


class RunnerError(Exception):
    pass


class LeaseLost(RunnerError):
    pass


class NetworkIdentityError(RunnerError):
    pass


def ensure_network_access(network, models, manifest, vnic_subnet_id, ensure):
    """Reconcile only this deployment's saved network, including legacy defaults."""
    if vnic_subnet_id != manifest.get("subnet"):
        raise NetworkIdentityError("The allocated VNIC uses an unexpected subnet")
    subnet=network.get_subnet(vnic_subnet_id).data
    if (subnet.vcn_id!=manifest.get("vcn") or subnet.route_table_id!=manifest.get("route")
        or subnet.security_list_ids!=[manifest.get("security")]):
        raise NetworkIdentityError("The saved subnet topology changed")
    route=network.get_route_table(manifest["route"]).data
    security=network.get_security_list(manifest["security"]).data
    gateway=network.get_internet_gateway(manifest["gateway"]).data
    for value in (subnet,route,security,gateway):
        tags=value.freeform_tags or {}
        if tags.get("deployment")!=manifest["deployment"] or tags.get("managed_by")!="StackSignal":
            raise NetworkIdentityError("Network ownership does not match this deployment")
    if any(v.vcn_id!=manifest["vcn"] for v in (route,security,gateway)) or not gateway.is_enabled:
        raise NetworkIdentityError("The saved internet gateway/network is not enabled")
    default=[r for r in route.route_rules if r.destination=="0.0.0.0/0"]
    if default and (len(default)!=1 or default[0].network_entity_id!=gateway.id):
        raise NetworkIdentityError("An unexpected default route needs review")
    if not default:
        ensure()
        network.update_route_table(route.id,models.UpdateRouteTableDetails(route_rules=[*route.route_rules,
            models.RouteRule(destination="0.0.0.0/0",destination_type="CIDR_BLOCK",network_entity_id=gateway.id)]))
    rules=list(security.ingress_security_rules)
    for port in (80,443):
        def permits(rule):
            ports=getattr(getattr(rule,"tcp_options",None),"destination_port_range",None)
            return rule.protocol=="6" and rule.source=="0.0.0.0/0" and ports and ports.min<=port<=ports.max
        if not any(permits(rule) for rule in rules):
            rules.append(models.IngressSecurityRule(protocol="6",source="0.0.0.0/0",source_type="CIDR_BLOCK",
                is_stateless=False,tcp_options=models.TcpOptions(destination_port_range=models.PortRange(min=port,max=port))))
    if len(rules)!=len(security.ingress_security_rules):
        ensure()
        network.update_security_list(security.id,models.UpdateSecurityListDetails(ingress_security_rules=rules))
    print(json.dumps({"status":"network_access_verified","internet_route":True,"web_ports":[80,443]}),flush=True)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


HTTP = urllib.request.build_opener(NoRedirect())


def signature(secret, timestamp, body, response=False):
    return "sha256=" + hmac.new(secret.encode(), (("response." if response else "") + timestamp + ".").encode() + body, hashlib.sha256).hexdigest()


def verify_response(secret, body, headers, now=None):
    stamp, digest = headers.get("x-stacksignal-timestamp", ""), headers.get("x-stacksignal-signature", "")
    return (bool(re.fullmatch(r"\d{10,12}", stamp)) and abs((now or time.time()) - int(stamp)) <= 300
            and hmac.compare_digest(digest, signature(secret, stamp, body, True)))


class Control:
    def __init__(self, secret, url=CONTROL_URL):
        if not re.fullmatch(r"[0-9a-f]{64}", secret) or url != CONTROL_URL:
            raise RunnerError("Control configuration invalid")
        self.secret, self.url, self.token = secret, url, None

    def call(self, action, data=None):
        body = json.dumps({"action": action, "run_token": self.token, "input": data or {}}, separators=(",", ":")).encode()
        stamp = str(int(time.time()))
        request = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json",
            "x-stacksignal-timestamp": stamp, "x-stacksignal-signature": signature(self.secret, stamp, body)}, method="POST")
        try:
            response = HTTP.open(request, timeout=35)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            result = response.read(32_001)
            if len(result) > 32_000 or not verify_response(self.secret, result, response.headers):
                raise RunnerError("Control reply authentication failed")
            if response.status != 200:
                raise LeaseLost("Control action refused; retain saved state for reconciliation")
        parsed = json.loads(result)
        if parsed.get("action") != action:
            raise RunnerError("Control reply action mismatch")
        return parsed["result"]


class Heartbeat:
    def __init__(self, control):
        self.control, self.stopped, self.lost = control, threading.Event(), threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while not self.stopped.wait(60):
            try:
                self.control.call("renew")
            except Exception:
                self.lost.set()
                return

    def ensure(self):
        if self.lost.is_set():
            raise LeaseLost("Lease heartbeat failed; stop new operations")

    def close(self):
        self.stopped.set()
        self.thread.join(timeout=40)


def private_file(path, contents):
    path.write_text(contents)
    path.chmod(0o600)


def global_ipv4(value):
    address = ipaddress.ip_address(value.strip())
    if address.version != 4 or not address.is_global:
        raise RunnerError("A routable IPv4 address is required")
    return str(address)


def runner_ip():
    for endpoint in ("https://api.ipify.org", "https://checkip.amazonaws.com"):
        try:
            with HTTP.open(endpoint, timeout=10) as response:
                return global_ipv4(response.read(100).decode())
        except Exception:
            continue
    raise RunnerError("Could not restrict SSH to this runner's public IPv4")


def console_host_key(console):
    # Host PUBLIC keys come from the authenticated OCI serial-console API.
    keys = re.findall(rb"ssh-ed25519\s+(AAAA[A-Za-z0-9+/=]+)", console)
    keys = set(keys)
    if len(keys) != 1:
        raise RunnerError("The authenticated boot console did not return one Ed25519 host key")
    raw = base64.b64decode(next(iter(keys)), validate=True)
    if len(raw) != 51 or raw[:19] != b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20":
        raise RunnerError("Invalid console host key")
    key = "ssh-ed25519 " + next(iter(keys)).decode()
    fingerprint = "SHA256:" + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")
    return key, fingerprint


def console_host_identity(compute, history_id):
    # OCI defaults to the first 10 KiB; Ubuntu's host keys appear later in boot.
    console=compute.get_console_history_content(history_id,offset=0,length=1024*1024).data
    return console_host_key(console)


def run_command(args, heartbeat, timeout=120, data=None):
    heartbeat.ensure()
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    heartbeat.ensure()
    if result.returncode:
        # Remote output can include package/config details: never copy it to logs.
        error=RunnerError("Reviewed host command failed; saved host will be resumed")
        error.command_exit=result.returncode
        error.command_diagnostic=command_diagnostic(result.stdout,result.stderr)
        raise error
    return result.stdout


def command_diagnostic(stdout, stderr):
    """Return only known codes/our own fixed markers; never raw remote output."""
    text=(stderr[-65536:]+b"\n"+stdout[-65536:]).decode(errors="replace")
    result={"codes":[code for code in ("ENOENT","EACCES","EBADENGINE","ECONNRESET","ENOTFOUND","ENOMEM","EINTEGRITY","E404","E401","ETARGET","EUSAGE") if code in text]}
    if "spawn git" in text.lower() and "ENOENT" in text:result["missing_git"]=True
    if "EACCES" in text:
        result["permission_context"]=[name for name,path in (("bootstrap_home","/home/ubuntu"),
            ("root_home","/root/"),("node_prefix","/opt/node/"),("service_state","/var/lib/stacksignal-bot/")) if path in text]
    for value,marker in (("ssh_timeout","Connection timed out"),("ssh_refused","Connection refused"),
                         ("ssh_authentication","Permission denied"),("ssh_identity","Host key verification failed")):
        if marker in text:result[value]=True
    lower=text.lower()
    for value,marker in (("plugin_source_confirmation","non-clawhub"),("plugin_already_exists","already exists"),
        ("plugin_capability_consent","requires capability consent"),("plugin_legacy_record","Pinned WhatsApp plugin has not been installed")):
        if marker.lower() in lower:result[value]=True
    for value,markers in (("package_lock",("could not get lock","frontend lock was locked","dpkg database lock")),
        ("package_dependency",("dependency problems","unmet dependencies")),
        ("package_architecture",("does not match system","wrong architecture")),
        ("package_archive",("not a debian format archive","cannot access archive","unexpected end of file")),
        ("disk_full",("no space left on device",)),("filesystem_readonly",("read-only file system",))):
        if any(marker in lower for marker in markers):result[value]=True
    allowed={"prerequisites","node","openclaw","ollama","caddy","service_users","whatsapp_plugin","config_validation","model_pull","complete"}
    for line in text.splitlines():
        try:entry=json.loads(line)
        except (ValueError,TypeError):continue
        if isinstance(entry,dict) and entry.get("status")=="bootstrap_step" and isinstance(entry.get("step"),str) and entry["step"] in allowed:
            result["bootstrap_step"]=entry["step"]
        if isinstance(entry,dict) and entry.get("status")=="plugin_verification_failed" and entry.get("reason") in (
            "plugin_identity","plugin_provenance","plugin_path","plugin_package","plugin_inspection"):
            result["plugin_verification"]=entry["reason"]
    return result


def failure_notice(error_type):
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        return
    run = os.environ.get("GITHUB_RUN_ID", "")
    if not run.isdigit():
        return
    body = {"body": "@Idoheled OCI bot provisioning needs attention: " + error_type + ". "
        "Existing deployment state was retained; no paid fallback was selected. "
        "Review https://github.com/Idoheled/StackSignal/actions/runs/" + run + "."}
    request = urllib.request.Request("https://api.github.com/repos/Idoheled/StackSignal/issues/4/comments",
        data=json.dumps(body).encode(), headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json",
        "Content-Type":"application/json","X-GitHub-Api-Version":"2026-03-10"}, method="POST")
    try:
        with HTTP.open(request,timeout=15) as response:
            response.read(100)
    except Exception:
        pass


def main():
    os.umask(0o077)
    if (os.environ.get("GITHUB_REPOSITORY") != "Idoheled/StackSignal"
        or os.environ.get("GITHUB_REF") != "refs/heads/feat/whatsapp-notifications"
        or not re.fullmatch(r"[0-9a-f]{40}",os.environ.get("GITHUB_SHA",""))):
        raise RunnerError("Run only the reviewed feature branch in GitHub Actions")
    required=("OCI_USER","OCI_TENANCY","OCI_FINGERPRINT","OCI_API_PRIVATE_KEY","SSH_ADMIN_PRIVATE_KEY",
              "SSH_ADMIN_PUBLIC_KEY","OCI_CRON_CONTROL_SECRET","OCI_CRON_CONTROL_WEBHOOK_URL","WHATSAPP_WEBHOOK_SECRET","WHATSAPP_APP_ORIGIN")
    control=Control(os.environ.get("OCI_CRON_CONTROL_SECRET",""),os.environ.get("OCI_CRON_CONTROL_WEBHOOK_URL",""))
    run_id=os.environ["GITHUB_RUN_ID"]+"."+os.environ.get("GITHUB_RUN_ATTEMPT","1")
    lease=control.call("lease",{"runner_id":run_id,"commit_sha":os.environ["GITHUB_SHA"]})
    if not lease["acquired"]:
        print(json.dumps({"status":"skipped","reason":lease.get("reason","disabled_or_leased")}))
        return 0
    state=lease["state"]
    if state["deployment_id"]!=DEPLOYMENT:
        raise RunnerError("Unexpected deployment state")
    control.token=state["lease_id"]
    missing=[name for name in required if not os.environ.get(name)]
    if missing:
        control.call("release",{"status":"PAUSED_ERROR","result":{"status":"missing_configuration","fields":missing}})
        failure_notice("required encrypted runner configuration is missing; cron paused")
        return 1
    heartbeat=Heartbeat(control);heartbeat.thread.start()
    manifest=dict(state["manifest"])
    spec=importlib.util.spec_from_file_location("oci_host",Path(__file__).with_name("oci-host.py"))
    host=importlib.util.module_from_spec(spec);spec.loader.exec_module(host)
    stage="inventory"

    def checkpoint(values=None):
        nonlocal state
        heartbeat.ensure()
        values=values or {}
        status="VM_ALLOCATED_INSTALLING" if manifest.get("instance") else "LAUNCH_IN_FLIGHT" if manifest.get("launch_request") else "SEARCHING_CAPACITY"
        payload={"status":status,"manifest":manifest,**values}
        if manifest.get("instance"):
            payload["instance_ocid"]=manifest["instance"]
        state=control.call("checkpoint",payload)

    def save(updated):
        nonlocal manifest
        manifest=updated
        # Do not leave an older OUT_OF_HOST_CAPACITY result beside a saved VM.
        checkpoint({"result":manifest["last_launch_result"]} if manifest.get("last_launch_result") else None)

    try:
        with tempfile.TemporaryDirectory(prefix="stacksignal-oci-",dir=os.environ.get("RUNNER_TEMP")) as temporary:
            runtime=Path(temporary)
            private_file(runtime/"api.pem",os.environ["OCI_API_PRIVATE_KEY"])
            private_file(runtime/"ssh",os.environ["SSH_ADMIN_PRIVATE_KEY"])
            private_file(runtime/"ssh.pub",os.environ["SSH_ADMIN_PUBLIC_KEY"])
            for name,prefix in (("OCI_USER","ocid1.user.oc1.."),("OCI_TENANCY","ocid1.tenancy.oc1..")):
                if not os.environ[name].startswith(prefix) or "\n" in os.environ[name]:
                    raise RunnerError("OCI identity configuration invalid")
            if not re.fullmatch(r"(?:[0-9a-f]{2}:){15}[0-9a-f]{2}",os.environ["OCI_FINGERPRINT"]):
                raise RunnerError("OCI fingerprint invalid")
            private_file(runtime/"config","[DEFAULT]\nuser="+os.environ["OCI_USER"]+"\ntenancy="+os.environ["OCI_TENANCY"]+
                "\nfingerprint="+os.environ["OCI_FINGERPRINT"]+"\nregion="+REGION+"\nkey_file="+str(runtime/"api.pem")+"\n")
            private_file(runtime/"host.json",json.dumps(manifest))
            ip=runner_ip()
            args=["--config",str(runtime/"config"),"--state-dir",str(runtime),"--ssh-public-key",str(runtime/"ssh.pub"),"--ssh-cidr",ip+"/32"]
            if not manifest.get("subnet") and not manifest.get("launch_request") and not manifest.get("instance"):
                stage="free_network_preparation"
                host.main(args+["--prepare-network"],on_manifest=save)
            stage="capacity_and_allocation"
            code=host.main(args+["--apply"],on_manifest=save)
            if code==2:
                result=manifest.get("last_launch_result",{})
                control.call("release",{"status":"SEARCHING_CAPACITY","manifest":manifest,
                    "result":result})
                attempts=len(result.get("attempts",[]))
                summary=os.environ.get("GITHUB_STEP_SUMMARY")
                if summary:
                    with open(summary,"a") as output:
                        output.write("## OCI allocation result\n\nNo VM was allocated. Oracle rejected all "+str(attempts)+
                            " `LaunchInstance` requests with `Out of host capacity`. The hourly cron remains active.\n\n"+
                            "Quality, Production and GitHub Release are intentionally skipped in `oci_capacity` mode on this feature branch.\n")
                print(json.dumps({"status":"waiting_for_capacity","operation":"LaunchInstance","launch_attempts":attempts,"next_check":"hourly"}))
                return 0
            if not manifest.get("instance"):
                raise RunnerError("No allocated instance in the reconciled state")
            import oci
            config=oci.config.from_file(str(runtime/"config"))
            options={"timeout":(10,20),"retry_strategy":oci.retry.NoneRetryStrategy()}
            compute=oci.core.ComputeClient(config,**options)
            network=oci.core.VirtualNetworkClient(config,**options)
            stage="wait_for_host"
            deadline=time.monotonic()+600
            while time.monotonic()<deadline:
                heartbeat.ensure()
                instance=compute.get_instance(manifest["instance"]).data
                if instance.lifecycle_state=="RUNNING":break
                if instance.lifecycle_state in ("TERMINATING","TERMINATED"):
                    raise host.HostError("The allocated host was terminated; manual reconciliation is required")
                time.sleep(10)
            else:raise RunnerError("Host is still booting; resume next run")
            if instance.shape!=host.SHAPE or (instance.shape_config.ocpus,instance.shape_config.memory_in_gbs) not in host.SIZES:
                raise host.HostError("Allocated host is outside the reviewed free envelope")
            attachments=oci.pagination.list_call_get_all_results(compute.list_vnic_attachments,
                compartment_id=config["tenancy"],instance_id=instance.id).data
            active=[a for a in attachments if a.lifecycle_state=="ATTACHED"]
            if len(active)!=1:raise RunnerError("Expected one attached VNIC")
            vnic=network.get_vnic(active[0].vnic_id).data
            public_ip=global_ipv4(vnic.public_ip)
            stage="verify_owned_network"
            ensure_network_access(network,oci.core.models,manifest,vnic.subnet_id,checkpoint)
            hostname="stacksignal."+public_ip+".sslip.io"
            checkpoint({"public_ip":public_ip,"shape_allocated":f"{host.SHAPE} {instance.shape_config.ocpus:g} OCPU / {instance.shape_config.memory_in_gbs:g} GB",
                "webhook_url":"https://"+hostname+"/v1/events"})
            summary=os.environ.get("GITHUB_STEP_SUMMARY")
            if summary:
                with open(summary,"a") as output:
                    output.write("## OCI VM claimed\n\nOracle confirms one RUNNING `"+instance.shape+"` host: "+
                        f"{instance.shape_config.ocpus:g} OCPU / {instance.shape_config.memory_in_gbs:g} GB RAM, 50 GB boot disk.\n\n"+
                        "Bot installation continues on this same host. WhatsApp delivery stays disabled until QR pairing.\n\n"+
                        "Quality, Production and GitHub Release skips are intentional for this provisioning mode.\n")

            def ssh_ingress(allow):
                heartbeat.ensure()
                security=network.get_security_list(manifest["security"]).data
                if (security.freeform_tags or {}).get("deployment")!=manifest["deployment"]:
                    raise host.HostError("SSH security list does not belong to this deployment")
                def is_ssh(rule):
                    ports=getattr(getattr(rule,"tcp_options",None),"destination_port_range",None)
                    return rule.protocol=="6" and ports and ports.min==22 and ports.max==22
                rules=[r for r in security.ingress_security_rules if not is_ssh(r)]
                if allow:
                    rules.append(oci.core.models.IngressSecurityRule(protocol="6",source=ip+"/32",source_type="CIDR_BLOCK",
                        is_stateless=False,tcp_options=oci.core.models.TcpOptions(destination_port_range=oci.core.models.PortRange(min=22,max=22))))
                network.update_security_list(security.id,oci.core.models.UpdateSecurityListDetails(ingress_security_rules=rules))
            ssh_ingress(True)
            stage="verify_ssh_identity"
            if not manifest.get("host_public_key"):
                # cloud-init emits host public keys on Ubuntu's authenticated serial console.
                deadline=time.monotonic()+360
                while time.monotonic()<deadline:
                    heartbeat.ensure()
                    history=compute.capture_console_history(oci.core.models.CaptureConsoleHistoryDetails(instance_id=instance.id),opc_retry_token=str(uuid.uuid4())).data
                    try:
                        for _ in range(18):
                            history=compute.get_console_history(history.id).data
                            if history.lifecycle_state=="SUCCEEDED":break
                            if history.lifecycle_state=="FAILED":raise RunnerError("Console capture failed")
                            time.sleep(5)
                        try:key,fingerprint=console_host_identity(compute,history.id)
                        except RunnerError:
                            time.sleep(10);continue
                        manifest.update(host_public_key=key,host_fingerprint=fingerprint);checkpoint();break
                    finally:
                        compute.delete_console_history(history.id)
                else:raise RunnerError("Host key not yet available through authenticated OCI console")
            # Validate durable public key and fingerprint again before trusting it.
            key,fingerprint=console_host_key(manifest["host_public_key"].encode())
            if fingerprint!=manifest["host_fingerprint"]:
                raise host.HostError("Saved SSH identity failed validation")
            private_file(runtime/"known_hosts",public_ip+" "+key+"\n")
            ssh_options=["-i",str(runtime/"ssh"),"-o","BatchMode=yes","-o","IdentitiesOnly=yes","-o","StrictHostKeyChecking=yes",
                "-o","UserKnownHostsFile="+str(runtime/"known_hosts"),"-o","ConnectTimeout=10","-o","ServerAliveInterval=20","-o","ServerAliveCountMax=3"]
            ssh=["ssh",*ssh_options,"ubuntu@"+public_ip]
            for attempt in range(30):
                try:run_command(ssh+["true"],heartbeat,30);break
                except RunnerError:
                    if attempt==29:raise
                    time.sleep(10)
            # Send the exact reviewed checkout, without repository credentials or .git.
            stage="copy_reviewed_code"
            archive=runtime/"source.tar"
            run_command(["git","archive","--format=tar","-o",str(archive),os.environ["GITHUB_SHA"]],heartbeat)
            run_command(["scp",*ssh_options,str(archive),"ubuntu@"+public_ip+":stacksignal-source.tar"],heartbeat,180)
            run_command(ssh+["sudo install -d -m 0755 /opt/stacksignal && sudo tar -xf stacksignal-source.tar -C /opt/stacksignal && rm stacksignal-source.tar"],heartbeat)
            diagnostic=json.loads(run_command(ssh+["sudo python3 /opt/stacksignal/bot/deploy/inspect-host.py"],heartbeat,30))
            print(json.dumps(diagnostic),flush=True)
            stage="install_pinned_runtime"
            print(json.dumps({"status":"installing_existing_host","stage":stage,"instance":instance.id}),flush=True)
            run_command(ssh+["sudo bash /opt/stacksignal/bot/deploy/install-host.sh"],heartbeat,2100)
            stage="configure_private_services"
            selected_model=manifest.get("selected_model","qwen3:4b")
            configuration=json.dumps({"secret":os.environ["WHATSAPP_WEBHOOK_SECRET"],"app_origin":os.environ["WHATSAPP_APP_ORIGIN"],"hostname":hostname,"model":selected_model}).encode()
            run_command(ssh+["sudo python3 /opt/stacksignal/bot/deploy/configure-host.py"],heartbeat,90,data=configuration)
            stage="verify_local_model"
            def benchmark(selected):
                return json.loads(run_command(ssh+["sudo -u stacksignal env OLLAMA_MODEL="+selected+" /opt/node/bin/node --experimental-strip-types /opt/stacksignal/bot/deploy/verify-model.mjs"],heartbeat,240))
            try:
                model=benchmark(selected_model)
            except (RunnerError,subprocess.TimeoutExpired):
                if selected_model!="qwen3:4b":raise
                # CPU-only 1 OCPU fallback still uses local inference and the same output validator.
                selected_model="qwen3:1.7b"
                run_command(ssh+["sudo env OLLAMA_HOST=127.0.0.1:11434 /usr/local/bin/ollama pull qwen3:1.7b"],heartbeat,600)
                configuration=json.dumps({"secret":os.environ["WHATSAPP_WEBHOOK_SECRET"],"app_origin":os.environ["WHATSAPP_APP_ORIGIN"],"hostname":hostname,"model":selected_model}).encode()
                run_command(ssh+["sudo python3 /opt/stacksignal/bot/deploy/configure-host.py"],heartbeat,90,data=configuration)
                model=benchmark(selected_model)
            manifest["selected_model"]=selected_model
            if model.get("ollama") is not True:raise RunnerError("Local model generation verification failed")
            run_command(ssh+["sudo systemctl is-active ollama stacksignal-openclaw stacksignal-bot caddy"],heartbeat)
            stage="verify_https"
            for attempt in range(30):
                try:
                    with HTTP.open("https://"+hostname+"/healthz",timeout=15) as response:
                        health=json.loads(response.read(1024))
                    if health.get("ok") is True and health.get("delivery_enabled") is False:break
                except Exception:
                    pass
                if attempt==29:raise RunnerError("Public HTTPS health verification did not pass")
                time.sleep(10)
            manifest["ready"]={"bootstrap":True,"ollama":True,"https":True,"model":model,
                "checked_at":datetime.now(timezone.utc).isoformat(),"commit_sha":os.environ["GITHUB_SHA"]}
            checkpoint()
            ssh_ingress(False)
            stage="signed_auto_stop"
            stopped=control.call("stop_cron")
            if stopped["status"]!="AWAITING_WHATSAPP_QR" or stopped["cron_enabled"]:
                raise RunnerError("Provisioning cron did not stop")
            for _ in range(2):
                if stopped.get("notification_sent"):break
                stopped=control.call("stop_cron")
            if not stopped.get("notification_sent"):
                failure_notice("host ready for QR, but owner notification delivery failed")
                raise RunnerError("Cron stopped safely; owner notification requires attention")
            print(json.dumps({"status":"AWAITING_WHATSAPP_QR","cron_enabled":False,"notification_sent":True,"delivery_enabled":False}))
            return 0
    except LeaseLost:
        failure_notice("lease or signed control was lost")
        raise
    except Exception as error:
        permanent=isinstance(error,host.HostError) and "not yet available" not in str(error)
        permanent=permanent or isinstance(error,NetworkIdentityError) or getattr(error,"status",None) in (401,403)
        result={"status":"PAUSED_ERROR" if permanent else "RETRY_PENDING","stage":stage,"type":type(error).__name__,
            "oci_status":getattr(error,"status",None),"checked_at":datetime.now(timezone.utc).isoformat()}
        if hasattr(error,"command_exit"):
            result.update(command_exit=error.command_exit,command_diagnostic=error.command_diagnostic)
        try:
            heartbeat.ensure()
            if state["status"] not in ("AWAITING_WHATSAPP_QR","VERIFIED_LIVE"):
                control.call("release",{"status":"PAUSED_ERROR" if permanent else state["status"],"manifest":manifest,"result":result})
        except Exception:
            pass
        if permanent or manifest.get("instance") or state.get("attempt_count",0)%24==0:
            failure_notice(result["status"]+" at "+stage)
        print(json.dumps(result))
        return 1
    finally:
        heartbeat.close()


if __name__=="__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({"status":"runner_incomplete","type":type(error).__name__}),file=sys.stderr)
        failure_notice("runner authentication or configuration failed")
        sys.exit(1)
