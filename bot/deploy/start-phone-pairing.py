#!/usr/bin/env python3
"""Root-only launcher. Private request arrives on SSH stdin, never argv/logs."""
import json
import os
from pathlib import Path
import pwd
import re
import subprocess
import sys
import time

os.umask(0o077)
if os.geteuid()!=0:raise SystemExit("Root required")
request=json.loads(sys.stdin.buffer.read(4097))
if (not re.fullmatch(r"[1-9][0-9]{7,14}",request.get("phone",""))
    or not re.fullmatch(r"[0-9a-f]{64}",request.get("key",""))
    or not re.fullmatch(r"[0-9a-f-]{36}",request.get("session",""))
    or not isinstance(request.get("expires_at"),int)
    or not time.time()*1000<request["expires_at"]<=time.time()*1000+900000):
    raise SystemExit("Invalid private request")
base=Path("/var/lib/stacksignal-bot")
env=dict(line.split("=",1) for line in Path("/etc/stacksignal/bot.env").read_text().splitlines() if line and not line.startswith("#") and "=" in line)
if env.get("WHATSAPP_GROUP_JID"):raise SystemExit("Preserve the active destination")
if subprocess.run(["systemctl","is-active","--quiet","stacksignal-pairing.service"]).returncode==0:
    raise SystemExit("A pairing operation is already active")
creds=base/"openclaw/credentials/whatsapp/default/creds.json"
if creds.is_symlink() or (creds.exists() and json.loads(creds.read_text()).get("registered")):
    raise SystemExit("Preserve the existing registered account")
user=pwd.getpwnam("stacksignal")
directory=base/"pairing"
if directory.is_symlink():raise SystemExit("Unsafe private directory")
directory.mkdir(mode=0o700,exist_ok=True)
os.chown(directory,user.pw_uid,user.pw_gid);directory.chmod(0o700)
path=directory/"request.json"
descriptor=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(descriptor,"w") as stream:json.dump(request,stream)
os.chown(path,user.pw_uid,user.pw_gid)
(directory/"result.json").unlink(missing_ok=True)
subprocess.run(["systemctl","stop","stacksignal-openclaw"],check=True)
try:
    subprocess.run(["systemd-run","--collect","--unit=stacksignal-pairing",
        "--property=User=stacksignal","--property=Group=stacksignal",
        "--property=WorkingDirectory=/var/lib/stacksignal-bot","--property=RuntimeMaxSec=600",
        "--property=StandardOutput=null","--property=StandardError=null",
        "--property=ExecStopPost=+/usr/bin/systemctl start stacksignal-openclaw",
        "--setenv=HOME=/var/lib/stacksignal-bot","--setenv=PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin",
        "--setenv=OPENCLAW_STATE_DIR=/var/lib/stacksignal-bot/openclaw",
        "--setenv=OPENCLAW_CONFIG_PATH=/var/lib/stacksignal-bot/openclaw/openclaw.json",
        "/opt/node/bin/node","/opt/stacksignal-pairing/bot/deploy/pair-phone.mjs"],
        check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
except Exception:
    path.unlink(missing_ok=True)
    subprocess.run(["systemctl","start","stacksignal-openclaw"],check=True)
    raise
print(json.dumps({"status":"pairing_started"}))
