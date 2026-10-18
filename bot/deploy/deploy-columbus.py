"""Guarded existing-host update with paired-state preservation and rollback."""
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.request

os.umask(0o077)
if os.geteuid()!=0:raise SystemExit('Root required')
request=json.loads(sys.stdin.buffer.read(16385));base=Path('/var/lib/stacksignal-bot');source=Path('/opt/stacksignal-pairing');runtime=Path('/opt/stacksignal')
if request.get('operation')!='columbus_deploy' or len(request.get('sha',''))!=40:raise SystemExit('Invalid release operation')
user=pwd.getpwnam('stacksignal')
run_as=['runuser','-u','stacksignal','--','env','HOME='+str(base),'PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin',
 'OPENCLAW_STATE_DIR='+str(base/'openclaw'),'OPENCLAW_CONFIG_PATH='+str(base/'openclaw/openclaw.json')]
report={'status':'incomplete','stage':'preflight'}
def deadline_expired(signum,frame):raise TimeoutError('Bounded deployment deadline exceeded')
signal.signal(signal.SIGALRM,deadline_expired);signal.alarm(660)
def command(args,data=None,timeout=120):
 result=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,cwd=base)
 if result.returncode:raise RuntimeError('Private command failed: '+str(result.returncode)+' '+result.stderr[-4000:].decode(errors='replace'))
 return result.stdout

def publish():
 script="import {readFileSync} from 'node:fs';import {encryptPrivateResult} from '/opt/stacksignal-pairing/bot/deploy/pair-phone.mjs';const x=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(encryptPrivateResult(x.result,x.request)));"
 raw=command(['/opt/node/bin/node','--input-type=module','-e',script],json.dumps({'request':request,'result':report}).encode())
 envelope=json.loads(raw);envelope['operation_ok']=report.get('status')=='ready'
 print(json.dumps(envelope))

def connected():
 last='No connected WhatsApp account'
 for attempt in range(15):
  try:
   value=json.loads(command(run_as+['/opt/node/bin/openclaw','channels','status','--json'],timeout=25))
   if any(a.get('connected') is True for a in value.get('channelAccounts',{}).get('whatsapp',[])):return
   last=json.dumps({'accounts':[{k:a.get(k) for k in ('enabled','configured','running','connected','lastError')} for a in value.get('channelAccounts',{}).get('whatsapp',[])]})
  except Exception as error:last=str(error)[-1500:]
  time.sleep(3)
 raise RuntimeError('WhatsApp did not reconnect: '+last)

backup=Path('/var/backups/stacksignal')/('columbus-'+request['sha']);saved=[];plugin_path=None;plugin_previous=None;modified=False
try:
 with sqlite3.connect((base/'deliveries.sqlite').as_uri()+'?mode=ro',uri=True) as db:
  if db.execute("select count(*) from deliveries where phase<>'sent'").fetchone()[0]:raise RuntimeError('Outstanding deliveries require reconciliation')
 identity=base/'openclaw/credentials/whatsapp/default/creds.json'
 if not json.loads(identity.read_text()).get('registered'):raise RuntimeError('Existing paired account required')
 cfg_path=base/'openclaw/openclaw.json';cfg=json.loads(cfg_path.read_text());wa=cfg.get('channels',{}).get('whatsapp',{})
 if wa.get('dmPolicy')!='disabled' or wa.get('groupPolicy')!='disabled' or cfg.get('tools',{}).get('deny')!=['*']:raise RuntimeError('Unexpected agent/chat policy')
 plugin=json.loads(command(run_as+['/opt/node/bin/openclaw','plugins','inspect','whatsapp','--json'],timeout=90))
 install=plugin.get('install',{})
 if install.get('resolvedName')!='@openclaw/whatsapp' or (install.get('resolvedVersion') or install.get('version'))!='2026.10.3':raise RuntimeError('Pinned plugin required')
 plugin_root=Path(install['installPath']).resolve()
 if not plugin_root.is_relative_to(base/'openclaw'):raise RuntimeError('Unexpected plugin root')
 plugin_path=plugin_root/'dist/.setup/socket-close-DU7eerAa.mjs';plugin_previous=plugin_path.read_bytes()
 report['stage']='verify_group';command(['systemctl','stop','stacksignal-openclaw'])
 try:
  destination=json.loads(command(run_as+['/opt/node/bin/node',str(source/'bot/deploy/verify-whatsapp-group.mjs')],json.dumps(request).encode(),timeout=150))
 finally:command(['systemctl','start','stacksignal-openclaw'])
 request['destination']=destination
 env=Path('/etc/stacksignal/bot.env');env_text=env.read_text()
 target_lines=[line for line in env_text.splitlines() if line.startswith('WHATSAPP_GROUP_JID=')]
 if target_lines!=['WHATSAPP_GROUP_JID='+destination['group_jid']]:raise RuntimeError('Fixed group differs from verified destination')
 report['stage']='install_runtime'
 command(['systemctl','stop','stacksignal-bot','stacksignal-openclaw'])
 backup.mkdir(parents=True,mode=0o700,exist_ok=True)
 saved.append((env,env_text.encode()));(backup/'bot.env').write_text(env_text)
 modified=True
 files=['bot/server.mjs','bot/store.mjs','bot/webhook.mjs','bot/worker.mjs','bot/transport.mjs','bot/message.mjs','bot/columbus-policy.mjs','bot/columbus-runtime.mjs','supabase/functions/_shared/whatsapp-protocol.ts']
 for name in files:
  dest=runtime/name;prior=dest.read_bytes() if dest.exists() else None;saved.append((dest,prior))
  if prior is not None:
   path=backup/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(prior)
  dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/name,dest);dest.chmod(0o644)
 # Keep adapter imports inside the managed plugin's source-capture boundary.
 # They are reviewed source, not an external loader exception or extra agent.
 for name in ('bot/columbus-policy.mjs','bot/columbus-runtime.mjs','supabase/functions/_shared/whatsapp-protocol.ts'):
  dest=plugin_root/'stacksignal'/name;prior=dest.read_bytes() if dest.exists() else None;saved.append((dest,prior))
  dest.parent.mkdir(parents=True,exist_ok=True)
  for parent in [dest.parent,*dest.parents]:
   if parent==plugin_root:break
   os.chown(parent,user.pw_uid,user.pw_gid);parent.chmod(0o755)
  shutil.copyfile(source/name,dest);os.chown(dest,user.pw_uid,user.pw_gid);dest.chmod(0o644)
 lines=[line for line in env_text.splitlines() if not line.startswith(('COLUMBUS_ENABLED=','COLUMBUS_ACTIVATED_AT='))]
 stamp=datetime.datetime.now(datetime.timezone.utc).isoformat()
 lines.extend(['COLUMBUS_ENABLED=true','COLUMBUS_ACTIVATED_AT='+stamp])
 temp=env.with_name('.columbus-env');temp.write_text('\n'.join(lines)+'\n');os.chown(temp,0,user.pw_gid);temp.chmod(0o640);temp.replace(env)
 spec=importlib.util.spec_from_file_location('boundary_patch',source/'bot/deploy/patch-whatsapp-boundary.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 module.patch(plugin_path)
 command(['/opt/node/bin/node','--check',str(plugin_path)])
 command(['systemctl','start','stacksignal-openclaw','stacksignal-bot']);connected()
 with urllib.request.urlopen('http://127.0.0.1:8787/healthz',timeout=5) as response:health=json.load(response)
 if health!={'ok':True,'delivery_enabled':True}:raise RuntimeError('Receiver unhealthy')
 log=command(['journalctl','-u','stacksignal-openclaw','--since',stamp,'--no-pager','-o','cat']).decode(errors='replace')
 if 'columbus_group_boundary_ready' not in log:raise RuntimeError('Group boundary did not initialize')
 if request.get('verification_mode')=='answer_only':
  report['stage']='final_answer_tests'
  smoke=json.loads(command(run_as+['/opt/node/bin/node',str(source/'bot/deploy/columbus-answer-smoke.mjs')],timeout=400))
  if smoke!={'status':'ready','languages':['en','he'],'final_answer_only':True,'group_messages_sent':0}:raise RuntimeError('Final answer verification failed')
  report['answer_verification']=smoke
 else:
  report['stage']='automatic_question_tests'
  smoke=json.loads(command(run_as+['/opt/node/bin/node',str(source/'bot/deploy/columbus-smoke.mjs')],json.dumps(request).encode(),timeout=500))
  if smoke.get('status')!='sent' or len(smoke.get('questions',[]))!=2:raise RuntimeError('Question test did not complete')
  report['questions']=smoke['questions']
 report['stage']='restart_verification';command(['systemctl','restart','stacksignal-openclaw','stacksignal-bot']);connected()
 report.update(status='ready',stage='complete',group_only=True,personal_chats=False,history=False,tools=False,paired_preserved=True,receiver=health,
   runtime_sha=request['sha'],boundary_sha256=hashlib.sha256(plugin_path.read_bytes()).hexdigest(),services={name:subprocess.run(['systemctl','is-active','--quiet',name]).returncode==0 for name in ('stacksignal-bot','stacksignal-openclaw','ollama','caddy')})
 (Path('/etc/stacksignal')/'runtime-source').write_text(request['sha']+'\n')
except Exception as error:
 report['diagnostic']=str(error)[-5000:]
 # Keep diagnostics inside the encrypted owner report, never public CI output.
 if modified:
  try:
   startup=command(['journalctl','-u','stacksignal-openclaw','--since',stamp,'--no-pager','-o','cat']).decode(errors='replace')
   report['startup_diagnostic']='\n'.join(line for line in startup.splitlines() if any(token in line.lower() for token in ('error','columbus','failed','exception','socket-close','at file:','at /')))[-12000:]
  except Exception:report['startup_diagnostic']='Startup diagnostics unavailable'
 if modified:
  subprocess.run(['systemctl','stop','stacksignal-bot','stacksignal-openclaw'],timeout=70)
  for dest,prior in reversed(saved):
   if prior is None:dest.unlink(missing_ok=True)
   else:dest.write_bytes(prior)
  if plugin_path and plugin_previous is not None:plugin_path.write_bytes(plugin_previous)
  if plugin_path:os.chown(plugin_path,user.pw_uid,user.pw_gid)
  subprocess.run(['systemctl','start','stacksignal-openclaw','stacksignal-bot'],timeout=30)
  report['rolled_back']=True
finally:
 signal.alarm(0)
 publish()
