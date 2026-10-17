#!/usr/bin/env python3
"""Read-only OCI Cloud Shell checks for StackSignal's WhatsApp host.

Uses the existing OCI CLI identity. Never reads, prints, or uploads credentials;
never creates resources. Quota availability is not host capacity or free billing.
"""

import json
import os
import shutil
import subprocess
import sys


READ_OPERATIONS = {
    ("iam", "region-subscription", "list"),
    ("iam", "availability-domain", "list"),
    ("compute", "shape", "list"),
    ("limits", "value", "list"),
    ("limits", "resource-availability", "get"),
}


class CheckError(Exception):
    pass


def cli(operation, options=()):
    """Execute only named read operations; do not echo raw CLI error output."""
    if tuple(operation) not in READ_OPERATIONS:
        raise CheckError("Refusing an operation outside the read-only allowlist.")
    command = ["oci"] + list(operation) + list(options) + [
        "--output", "json", "--connection-timeout", "10",
        "--read-timeout", "20", "--max-retries", "1",
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=75)
    except subprocess.TimeoutExpired:
        raise CheckError("OCI request timed out; check Cloud Shell's selected region/network.")
    if result.returncode:
        raise CheckError("OCI read failed; check IAM permission and CLI authentication in Cloud Shell.")
    try:
        return json.loads(result.stdout)["data"]
    except (ValueError, KeyError, TypeError):
        raise CheckError("OCI returned an unexpected response; no readiness assertion was made.")


def detect_identity(regions, domains):
    home = [r.get("region-name") for r in regions if r.get("is-home-region") is True]
    tenancies = {d.get("compartment-id") for d in domains if d.get("compartment-id")}
    if len(home) != 1 or len(tenancies) != 1:
        raise CheckError("Could not identify one home region and tenancy from OCI metadata.")
    tenancy = tenancies.pop()
    if not tenancy.startswith("ocid1.tenancy."):
        raise CheckError("Availability-domain metadata did not identify a tenancy OCID.")
    return home[0], tenancy


def quota_check(tenancy, region, value, run):
    options = ["--compartment-id", tenancy, "--service-name", "compute",
               "--limit-name", value["name"], "--region", region]
    scope = value.get("scope-type")
    if scope == "AD":
        domain = value.get("availability-domain")
        if not domain:
            raise CheckError("An availability-domain quota has no domain; availability is unknown.")
        options += ["--availability-domain", domain]
    elif scope not in ("REGION", "GLOBAL"):
        raise CheckError("Unknown quota scope; availability is unknown.")
    data = run(("limits", "resource-availability", "get"), options)
    # Explicit projection prevents arbitrary response fields reaching the report.
    return {
        "name": value["name"], "scope": scope,
        "availability_domain": value.get("availability-domain"),
        "service_limit": value.get("value"),
        "available": data.get("available"), "used": data.get("used"),
    }


def build_report(run=cli):
    regions = run(("iam", "region-subscription", "list"), ["--all"])
    domains = run(("iam", "availability-domain", "list"), ["--all"])
    home, tenancy = detect_identity(regions, domains)
    base = ["--compartment-id", tenancy, "--region", home, "--all"]
    domains = run(("iam", "availability-domain", "list"), base)
    shapes = run(("compute", "shape", "list"), base)
    values = run(("limits", "value", "list"), base + ["--service-name", "compute"])
    quotas = []
    for value in values:
        if not value.get("name", "").startswith("standard-a1-"):
            continue
        if "reserv" in value["name"]:
            continue
        try:
            quotas.append(quota_check(tenancy, home, value, run))
        except CheckError as error:
            quotas.append({"name": value["name"], "scope": value.get("scope-type"),
                           "availability_domain": value.get("availability-domain"),
                           "service_limit": value.get("value"), "available": None,
                           "check_error": str(error)})
    return {
        "check": "StackSignal OCI onboarding (read-only)",
        "home_region": home,
        "cloud_shell_region": os.environ.get("OCI_REGION") or os.environ.get("OCI_CLI_REGION"),
        "tenancy_ocid": tenancy,
        "availability_domains": [d["name"] for d in domains],
        "a1_shape_listed": any(s.get("shape") == "VM.Standard.A1.Flex" for s in shapes),
        "a1_service_quotas": quotas,
        "proposed_host": {"shape": "VM.Standard.A1.Flex", "ocpus": 2, "memory_gb": 12},
        "host_capacity": "Not checked; shape/quotas do not guarantee launch capacity.",
        "billing": "Not checked; service limits do not establish Always Free eligibility.",
        "resources_created": 0,
        "credentials_included": False,
    }


def main():
    if not shutil.which("oci"):
        print("Run this in Oracle Cloud Shell, where the OCI CLI is pre-authenticated.", file=sys.stderr)
        return 1
    try:
        print(json.dumps(build_report(), indent=2))
        return 0
    except (CheckError, TypeError, KeyError) as error:
        # Only our messages are printed; raw OCI stderr/configuration are excluded.
        message = str(error) if isinstance(error, CheckError) else "OCI response schema changed; check manually."
        print("Preflight incomplete: " + message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
