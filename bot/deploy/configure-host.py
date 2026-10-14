#!/usr/bin/env python3
"""Receive configuration on stdin after verified SSH; never print credentials."""
import json
import os
import re
import subprocess
from pathlib import Path

os.umask(0o077)
if os.geteuid() != 0:
    raise SystemExit("Root required")
import sys
configuration = json.loads(sys.stdin.buffer.read(4097))
secret, origin, hostname = (configuration[name] for name in ("secret", "app_origin", "hostname"))
model = configuration.get("model", "qwen3:4b")
if (not re.fullmatch(r"[0-9a-f]{64}", secret)
    or origin != "https://stacksignal.stacksignal-idoheled.workers.dev"
    or model not in ("qwen3:4b", "qwen3:1.7b")
    or not re.fullmatch(r"stacksignal\.(?:[0-9]{1,3}\.){3}[0-9]{1,3}\.sslip\.io", hostname)):
    raise SystemExit("Invalid dedicated-host configuration")
path = Path("/etc/stacksignal/bot.env")
existing = dict(line.split("=",1) for line in path.read_text().splitlines() if line and not line.startswith("#") and "=" in line)
if existing.get("WHATSAPP_GROUP_JID"):
    raise SystemExit("A destination already exists; preserve the paired configuration")
path.write_text(f"WHATSAPP_WEBHOOK_SECRET={secret}\nWHATSAPP_APP_ORIGIN={origin}\nWHATSAPP_GROUP_JID=\nOLLAMA_MODEL={model}\n")
subprocess.run(["chown","root:stacksignal",str(path)],check=True)
path.chmod(0o640)
openclaw_path = Path("/var/lib/stacksignal-bot/openclaw/openclaw.json")
openclaw = json.loads(openclaw_path.read_text())
openclaw["agents"]["entries"]["notification"].update(model="ollama/"+model,utilityModel="ollama/"+model)
openclaw_path.write_text(json.dumps(openclaw,indent=2)+"\n")
Path("/etc/caddy/Caddyfile").write_text(Path("/opt/stacksignal/bot/deploy/Caddyfile").read_text())
Path("/etc/caddy/Caddyfile").chmod(0o644)
directory = Path("/etc/systemd/system/caddy.service.d")
directory.mkdir(exist_ok=True)
dropin = directory / "stacksignal.conf"
dropin.write_text(f"[Service]\nEnvironment=WHATSAPP_BOT_HOST={hostname}\n")
dropin.chmod(0o644)
# OCI Ubuntu's INPUT chain can end with REJECT. Add only the intended web ports.
for port in (80,443):
    rule=["INPUT","-p","tcp","--dport",str(port),"-m","comment","--comment","stacksignal-web","-j","ACCEPT"]
    if subprocess.run(["iptables","-C",*rule],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode:
        subprocess.run(["iptables","-I",*rule],check=True)
if Path("/etc/iptables/rules.v4").parent.exists():
    with open("/etc/iptables/rules.v4","w") as output:
        subprocess.run(["iptables-save"],stdout=output,check=True)
subprocess.run(["systemctl","daemon-reload"],check=True)
subprocess.run(["systemctl","enable","--now","stacksignal-openclaw","stacksignal-bot","caddy"],check=True)
print(json.dumps({"configured":True,"delivery_enabled":False}))
