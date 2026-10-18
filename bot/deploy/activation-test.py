#!/usr/bin/env python3
"""Verify the private destination, resume the gateway and send one guarded test."""
import json
import os
from pathlib import Path
import pwd
import subprocess
import sys
import time

os.umask(0o077)
if os.geteuid()!=0:raise SystemExit("Root required")
request=json.loads(sys.stdin.buffer.read(8193));base=Path('/var/lib/stacksignal-bot');source=Path('/opt/stacksignal-pairing/bot/deploy')
if subprocess.run(['systemctl','is-active','--quiet','stacksignal-pairing.service']).returncode==0:
    raise SystemExit('Pairing is still active')
user=pwd.getpwnam('stacksignal');directory=base/'activation'
if directory.is_symlink():raise SystemExit('Invalid private directory')
directory.mkdir(mode=0o700,exist_ok=True);os.chown(directory,user.pw_uid,user.pw_gid);directory.chmod(0o700)
identity=base/'openclaw/credentials/whatsapp/default/creds.json'
if not identity.exists() or not json.loads(identity.read_text()).get('registered'):raise SystemExit('Account is not linked')
run_as=['runuser','-u','stacksignal','--','env','HOME=/var/lib/stacksignal-bot','PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin',
    'OPENCLAW_STATE_DIR=/var/lib/stacksignal-bot/openclaw','OPENCLAW_CONFIG_PATH=/var/lib/stacksignal-bot/openclaw/openclaw.json']
stage='verify_group'
def command(args,data=None,timeout=120):
    result=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,cwd=base)
    if result.returncode:
        payload={'request':request,'result':{'error_stage':stage,'exit':result.returncode,'diagnostic':result.stderr[-16000:].decode(errors='replace')}}
        script="import {readFileSync} from 'node:fs';import {encryptPrivateResult} from '/opt/stacksignal-pairing/bot/deploy/pair-phone.mjs';const x=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(encryptPrivateResult(x.result,x.request)));"
        encoded=subprocess.run(['/opt/node/bin/node','--input-type=module','-e',script],input=json.dumps(payload).encode(),capture_output=True,check=True)
        print(encoded.stdout.decode().strip())
        raise SystemExit(0)
    return result.stdout
subprocess.run(['systemctl','stop','stacksignal-openclaw'],check=True)
try:
    raw=command(run_as+['/opt/node/bin/node',str(source/'verify-whatsapp-group.mjs')],json.dumps(request).encode(),timeout=150)
    destination=json.loads(raw)
finally:
    subprocess.run(['systemctl','start','stacksignal-openclaw'],check=True)
request['destination']=destination
stage='gateway_status'
# Inspect the pinned gateway status contract before attempting a real send.
for attempt in range(12):
    try:
        status=json.loads(command(run_as+['/opt/node/bin/openclaw','channels','status','--json'],timeout=25))
        accounts=status.get('channelAccounts',{}).get('whatsapp',[])
        if any(a.get('connected') is True for a in accounts):break
    except Exception:pass
    if attempt==11:raise SystemExit('Gateway WhatsApp listener is not connected')
    time.sleep(5)
if request.get('operation')=='delivery_readiness':
    import importlib.util
    import urllib.request
    spec=importlib.util.spec_from_file_location('delivery_config',source/'delivery-config.py')
    delivery_config=importlib.util.module_from_spec(spec);spec.loader.exec_module(delivery_config)
    stage='configure_delivery'
    subprocess.run(['systemctl','stop','stacksignal-bot'],check=True)
    try:
        report=delivery_config.configure_delivery(Path('/etc/stacksignal/bot.env'),base/'deliveries.sqlite',destination['group_jid'])
    finally:
        subprocess.run(['systemctl','start','stacksignal-bot'],check=True)
    for attempt in range(15):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8787/healthz',timeout=3) as response:
                health=json.load(response)
            if health.get('ok') and health.get('delivery_enabled'):break
        except Exception:pass
        if attempt==14:raise SystemExit('Configured delivery health failed')
        time.sleep(1)
    report.update(health=health,gateway_connected=True,services={name:subprocess.run(['systemctl','is-active','--quiet',name]).returncode==0
        for name in ('stacksignal-bot','stacksignal-openclaw','ollama','caddy')})
    script="import {readFileSync} from 'node:fs';import {encryptPrivateResult} from '/opt/stacksignal-pairing/bot/deploy/pair-phone.mjs';const x=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(encryptPrivateResult(x.result,x.request)));"
    encoded=subprocess.run(['/opt/node/bin/node','--input-type=module','-e',script],input=json.dumps({'request':request,'result':report}).encode(),capture_output=True,check=True)
    print(encoded.stdout.decode().strip())
else:
    raw=command(run_as+['/opt/node/bin/node',str(source/'send-activation.mjs')],json.dumps(request).encode(),timeout=90)
    print(raw.decode().strip())
