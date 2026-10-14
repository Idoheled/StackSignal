#!/usr/bin/env python3
"""Bounded OCI SDK capacity check and resumable, free-envelope host provisioning.

Default: read account inventory and capacity only. --apply provisions one host
only after the checks pass. Credential/config/state files must live outside git.
Install SDK separately: python3 -m pip install oci==2.187.2
"""
import argparse
import base64
import ipaddress
import json
import os
from pathlib import Path
import sys
import uuid
from datetime import datetime, timezone

SHAPE = "VM.Standard.A1.Flex"
SIZES = [(2, 12), (1, 8)]
BOOT_GB = 50


class HostError(Exception):
    pass


def free_guard(region, home, instances, volumes, deployment=None):
    if region != home:
        raise HostError("Always Free compute must use the home region.")
    active = [i for i in instances if i["state"] != "TERMINATED"]
    owned = [i for i in active if deployment and i.get("deployment") == deployment]
    if len(owned) > 1:
        raise HostError("Multiple deployment instances exist; reconcile before continuing.")
    others = [i for i in active if i not in owned]
    # New-tenancy guard: do not infer free eligibility from a generous service limit.
    if others:
        raise HostError("Existing compute needs a tenancy-wide free-budget review before launch.")
    if any(i["shape"] != SHAPE or i["ocpus"] > 2 or i["memory"] > 12 for i in owned):
        raise HostError("Existing deployment is outside the reviewed free envelope.")
    used = sum(v["size"] for v in volumes if v["state"] != "TERMINATED")
    if used + (0 if owned else BOOT_GB) > 200:
        raise HostError("Provisioning would exceed the 200 GB Always Free volume allowance.")
    return owned


def ssh_rule(value):
    network = ipaddress.ip_network(value, strict=True)
    if network.version != 4 or network.prefixlen < 24:
        raise HostError("SSH requires a specific IPv4 /24 or narrower administrative network.")
    return str(network)


def read_public_key(path):
    value = Path(path).read_text().strip()
    parts = value.split()
    if len(parts) < 2 or parts[0] != "ssh-ed25519":
        raise HostError("Use a dedicated Ed25519 SSH public key, separate from OCI API signing keys.")
    try:
        raw = base64.b64decode(parts[1], validate=True)
        if len(raw) != 51 or raw[:19] != b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20":
            raise ValueError()
    except ValueError:
        raise HostError("Invalid Ed25519 public key.")
    return " ".join(parts[:2])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--ssh-public-key")
    parser.add_argument("--ssh-cidr")
    args = parser.parse_args()
    os.umask(0o077)
    state_dir = Path(args.state_dir).resolve()
    repo = Path(__file__).resolve().parent.parent
    if state_dir == repo or repo in state_dir.parents or repo in Path(args.config).resolve().parents:
        raise HostError("Keep credentials and provisioning state outside the source repository.")
    import oci  # Optional runtime dependency; not needed for policy tests.
    config = oci.config.from_file(args.config)
    tenancy = config["tenancy"]
    options = {"timeout": (10, 20), "retry_strategy": oci.retry.NoneRetryStrategy()}
    identity = oci.identity.IdentityClient(config, **options)
    compute = oci.core.ComputeClient(config, **options)
    volumes_client = oci.core.BlockstorageClient(config, **options)
    network = oci.core.VirtualNetworkClient(config, **options)

    def all_items(call, **kwargs):
        return oci.pagination.list_call_get_all_results(call, **kwargs, retry_strategy=oci.retry.NoneRetryStrategy()).data

    regions = all_items(identity.list_region_subscriptions, tenancy_id=tenancy)
    homes = [r.region_name for r in regions if r.is_home_region]
    if len(homes) != 1 or config["region"] != homes[0]:
        raise HostError("The configured region is not the verified home region.")
    # This review targets a single-region new tenancy. Never silently ignore usage elsewhere.
    if len([r for r in regions if r.status == "READY"]) != 1:
        raise HostError("Multiple subscribed regions require a complete usage review before provisioning.")
    compartments = [tenancy] + [c.id for c in all_items(identity.list_compartments,
        compartment_id=tenancy, compartment_id_in_subtree=True, access_level="ANY") if c.lifecycle_state == "ACTIVE"]
    if len(compartments) > 20:
        raise HostError("Large tenancy requires a separate bounded inventory review.")
    domains = all_items(identity.list_availability_domains, compartment_id=tenancy)
    if not domains:
        raise HostError("No availability domain returned.")
    instances, volumes = [], []
    for compartment in compartments:
        instances += all_items(compute.list_instances, compartment_id=compartment)
        volumes += all_items(volumes_client.list_volumes, compartment_id=compartment)
        for domain in domains:
            volumes += all_items(volumes_client.list_boot_volumes, compartment_id=compartment, availability_domain=domain.name)
    manifest_path = state_dir / "host.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"deployment": str(uuid.uuid4()), "launch_token": str(uuid.uuid4())}
    if manifest.get("tenancy", tenancy) != tenancy or manifest.get("region", config["region"]) != config["region"]:
        raise HostError("Provisioning state belongs to another tenancy/region.")
    instance_summary = [{"id": i.id, "state": i.lifecycle_state, "shape": i.shape,
        "ocpus": getattr(i.shape_config, "ocpus", 0) or 0, "memory": getattr(i.shape_config, "memory_in_gbs", 0) or 0,
        "deployment": (i.freeform_tags or {}).get("deployment")} for i in instances]
    volume_summary = [{"size": v.size_in_gbs, "state": v.lifecycle_state} for v in volumes]
    owned = free_guard(config["region"], homes[0], instance_summary, volume_summary, manifest["deployment"])
    if owned:
        print(json.dumps({"status": "existing_instance", "instance_id": owned[0]["id"], "state": owned[0]["state"], "resources_created": 0}))
        return 0
    reports, choice = [], None
    for domain in domains:
        faults = all_items(identity.list_fault_domains, compartment_id=tenancy, availability_domain=domain.name)
        details = oci.core.models.CreateComputeCapacityReportDetails(compartment_id=tenancy, availability_domain=domain.name,
            shape_availabilities=[oci.core.models.CreateCapacityReportShapeAvailabilityDetails(
                instance_shape=SHAPE, fault_domain=fd, instance_shape_config=oci.core.models.CapacityReportInstanceShapeConfig(ocpus=cpu, memory_in_gbs=ram))
                for fd in [None] + [f.name for f in faults] for cpu, ram in SIZES])
        result = compute.create_compute_capacity_report(details).data
        for item in result.shape_availabilities:
            cpu, ram = item.instance_shape_config.ocpus, item.instance_shape_config.memory_in_gbs
            if item.instance_shape != SHAPE or (cpu, ram) not in SIZES:
                raise HostError("Capacity response is outside the reviewed free envelope.")
            reports.append({"domain": domain.name, "fault_domain": item.fault_domain, "ocpus": cpu, "memory_gb": ram, "status": item.availability_status})
            if item.availability_status == "AVAILABLE" and (choice is None or cpu > choice[2]):
                choice = (domain.name, item.fault_domain, cpu, ram)
    if not choice:
        print(json.dumps({"status": "out_of_host_capacity", "checked_at": datetime.now(timezone.utc).isoformat(), "resources_created": 0, "capacity": reports}))
        return 2
    if not args.apply:
        print(json.dumps({"status": "capacity_available", "shape": SHAPE, "ocpus": choice[2], "memory_gb": choice[3], "boot_gb": BOOT_GB, "resources_created": 0}))
        return 0
    if not args.ssh_public_key or not args.ssh_cidr:
        raise HostError("--apply requires --ssh-public-key and --ssh-cidr.")
    public_key, admin_cidr = read_public_key(args.ssh_public_key), ssh_rule(args.ssh_cidr)
    images = all_items(compute.list_images, compartment_id=tenancy, operating_system="Canonical Ubuntu", operating_system_version="24.04", shape=SHAPE, sort_by="TIMECREATED", sort_order="DESC")
    images = [i for i in images if "aarch64" in i.display_name and i.lifecycle_state == "AVAILABLE"]
    if not images:
        raise HostError("No compatible Ubuntu 24.04 ARM image found.")
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest.update(tenancy=tenancy, region=config["region"])
    tags = {"managed_by": "StackSignal", "deployment": manifest["deployment"]}

    def save():
        temporary = manifest_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(manifest, indent=2) + "\n")
        temporary.replace(manifest_path)
    save()  # Persist idempotency token before the first mutation.

    def resource(label, items, create):
        matches = [i for i in items if getattr(i, "freeform_tags", {}) == tags and i.lifecycle_state != "TERMINATED"]
        if len(matches) > 1:
            raise HostError("Duplicate deployment resources; reconcile " + label + " before continuing.")
        value = matches[0] if matches else create().data
        if value.lifecycle_state != "AVAILABLE":
            raise HostError(label + " is not yet available; rerun after it finishes provisioning.")
        manifest[label] = value.id
        save()
        return value

    m = oci.core.models
    vcn = resource("vcn", all_items(network.list_vcns, compartment_id=tenancy), lambda: network.create_vcn(m.CreateVcnDetails(
        compartment_id=tenancy, cidr_block="10.42.0.0/16", display_name="stacksignal-whatsapp", dns_label="stacksignal", freeform_tags=tags), opc_retry_token=manifest["deployment"]))
    gateway = resource("gateway", all_items(network.list_internet_gateways, compartment_id=tenancy, vcn_id=vcn.id), lambda: network.create_internet_gateway(m.CreateInternetGatewayDetails(
        compartment_id=tenancy, vcn_id=vcn.id, is_enabled=True, display_name="stacksignal-whatsapp", freeform_tags=tags), opc_retry_token=manifest["deployment"]))
    route = resource("route", all_items(network.list_route_tables, compartment_id=tenancy, vcn_id=vcn.id), lambda: network.create_route_table(m.CreateRouteTableDetails(
        compartment_id=tenancy, vcn_id=vcn.id, display_name="stacksignal-whatsapp", freeform_tags=tags,
        route_rules=[m.RouteRule(destination="0.0.0.0/0", destination_type="CIDR_BLOCK", network_entity_id=gateway.id)]), opc_retry_token=manifest["deployment"]))
    rules = [m.IngressSecurityRule(protocol="6", source=source, source_type="CIDR_BLOCK", is_stateless=False,
        tcp_options=m.TcpOptions(destination_port_range=m.PortRange(min=port, max=port))) for port, source in [(22, admin_cidr), (80, "0.0.0.0/0"), (443, "0.0.0.0/0")]]
    rules.append(m.IngressSecurityRule(protocol="1", source="0.0.0.0/0", source_type="CIDR_BLOCK", is_stateless=False,
        icmp_options=m.IcmpOptions(type=3, code=4)))  # IPv4 path MTU discovery.
    security = resource("security", all_items(network.list_security_lists, compartment_id=tenancy, vcn_id=vcn.id), lambda: network.create_security_list(m.CreateSecurityListDetails(
        compartment_id=tenancy, vcn_id=vcn.id, display_name="stacksignal-whatsapp", freeform_tags=tags, ingress_security_rules=rules,
        egress_security_rules=[m.EgressSecurityRule(protocol="all", destination="0.0.0.0/0", destination_type="CIDR_BLOCK", is_stateless=False)]), opc_retry_token=manifest["deployment"]))
    subnet = resource("subnet", all_items(network.list_subnets, compartment_id=tenancy, vcn_id=vcn.id), lambda: network.create_subnet(m.CreateSubnetDetails(
        compartment_id=tenancy, vcn_id=vcn.id, cidr_block="10.42.1.0/24", route_table_id=route.id, security_list_ids=[security.id],
        prohibit_public_ip_on_vnic=False, display_name="stacksignal-whatsapp", dns_label="whatsapp", freeform_tags=tags), opc_retry_token=manifest["deployment"]))
    instance = compute.launch_instance(m.LaunchInstanceDetails(
        compartment_id=tenancy, availability_domain=choice[0], fault_domain=choice[1], display_name="stacksignal-whatsapp", freeform_tags=tags,
        shape=SHAPE, shape_config=m.LaunchInstanceShapeConfigDetails(ocpus=choice[2], memory_in_gbs=choice[3]),
        source_details=m.InstanceSourceViaImageDetails(image_id=images[0].id, boot_volume_size_in_gbs=BOOT_GB, boot_volume_vpus_per_gb=10),
        create_vnic_details=m.CreateVnicDetails(subnet_id=subnet.id, assign_public_ip=True, hostname_label="whatsapp"),
        metadata={"ssh_authorized_keys": public_key}), opc_retry_token=manifest["launch_token"]).data
    manifest["instance"] = instance.id
    save()
    print(json.dumps({"status": "instance_requested", "instance_id": instance.id, "state": instance.lifecycle_state, "shape": SHAPE, "ocpus": choice[2], "memory_gb": choice[3], "boot_gb": BOOT_GB}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except HostError as error:
        print(json.dumps({"error": str(error), "completed": False}), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        # Never print SDK request headers, credential paths, key data or raw responses.
        print(json.dumps({"error": "OCI operation incomplete; reconcile saved resource state before retrying.", "type": type(error).__name__, "status": getattr(error, "status", None), "code": getattr(error, "code", None)}), file=sys.stderr)
        sys.exit(1)
