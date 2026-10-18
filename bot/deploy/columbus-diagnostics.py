"""Read-only runtime diagnostics. Never return messages, addresses or credentials."""
import json
from pathlib import Path
import sqlite3
import subprocess
import sys

request=json.loads(sys.stdin.buffer.read(16385))
base=Path('/var/lib/stacksignal-bot')
log=subprocess.run(['journalctl','-u','stacksignal-openclaw','--since','2 hours ago','--no-pager','-o','cat'],capture_output=True,text=True,timeout=20).stdout
needles=['columbus_group_boundary_ready','failed to decrypt message','error in handling message','processing message','History sync is disabled','Connection is now AwaitingInitialSync','connection closed','bad mac','No session record','Key used already','receipient present, but msg not from me','No participant in group message']
report={'status':'ready','log_counts':{s:log.lower().count(s.lower()) for s in needles},'runtime_sha':Path('/etc/stacksignal/runtime-source').read_text().strip()}
with sqlite3.connect((base/'columbus.sqlite').as_uri()+'?mode=ro',uri=True) as db:
 report['questions']=[dict(zip(['status','created_at','error_code'],row)) for row in db.execute('select status,created_at,error_code from questions order by created_at desc limit 15')]
 if db.execute("select 1 from sqlite_master where name='receive_counters'").fetchone():
  report['receive_counters']=[dict(zip(['code','n','last_seen'],row)) for row in db.execute('select code,n,last_seen from receive_counters order by code')]
creds=json.loads((base/'openclaw/credentials/whatsapp/default/creds.json').read_text())
report['identity']={'registered':bool(creds.get('registered')),'has_id':bool(creds.get('me',{}).get('id')),'has_lid':bool(creds.get('me',{}).get('lid'))}
report['services']={name:subprocess.run(['systemctl','is-active','--quiet',name]).returncode==0 for name in ('stacksignal-openclaw','stacksignal-bot','ollama','caddy')}
if request.get('quality_audit') is True:
 # Only checked-in synthetic prompts. No group text, provider keys or chat sends.
 env=dict(line.split('=',1) for line in Path('/etc/stacksignal/bot.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
 try:
  audit=subprocess.run(['runuser','-u','stacksignal','--','env','OLLAMA_MODEL='+env.get('OLLAMA_MODEL','qwen3:4b'),'/opt/node/bin/node','/opt/stacksignal-pairing/bot/deploy/columbus-model-audit.mjs'],capture_output=True,timeout=440)
  if audit.returncode:report['model_audit_error']='Synthetic model audit failed'
  else:report['model_audit']=json.loads(audit.stdout)
 except subprocess.TimeoutExpired:report['model_audit_error']='Synthetic model audit timed out'
script="import {readFileSync} from 'node:fs';import {encryptPrivateResult} from '/opt/stacksignal-pairing/bot/deploy/pair-phone.mjs';const x=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(encryptPrivateResult(x.result,x.request)));"
result=subprocess.run(['/opt/node/bin/node','--input-type=module','-e',script],input=json.dumps({'request':request,'result':report}).encode(),capture_output=True,timeout=10,check=True)
print(result.stdout.decode().strip())
