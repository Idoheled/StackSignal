// Explicit owner-authorized group test. Durable intent prevents replay on rerun.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {sendWhatsApp} from '/opt/stacksignal/bot/transport.mjs';
import {requireGroup} from '/opt/stacksignal/bot/columbus-policy.mjs';
process.umask(0o077);
const request=JSON.parse(readFileSync(0,'utf8')),target=requireGroup(request.destination.group_jid);
if(!request.destination.group_verified || request.destination.group_name!=='StackSignal' || !/^[a-f0-9]{40}$/.test(request.sha))throw Error('Verified release request required');
const path='/var/lib/stacksignal-bot/activation/columbus-'+request.sha+'.json';
if(existsSync(path)){
 const prior=JSON.parse(readFileSync(path,'utf8'));if(prior.status==='sent'){console.log(JSON.stringify(prior));process.exit(0);}throw Error('Prior question test requires reconciliation');
}
const report={status:'started',questions:[]};writeFileSync(path,JSON.stringify(report),{mode:0o600,flag:'wx'});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const question of ['קולומבוס מה כל שבעת הreleaseים האחרונים שנכנסו לפלטפורמה?']){
 const id=await sendWhatsApp(question,{target,executable:'/opt/node/bin/openclaw'});
 const entry={question_id:id,status:'sent_to_group'};report.questions.push(entry);writeFileSync(path,JSON.stringify(report));
 let found=false;
 for(let attempt=0;attempt<100;attempt++){
  const db=new DatabaseSync('/var/lib/stacksignal-bot/columbus.sqlite',{readOnly:true});let row;
  try{row=db.prepare('select status,message_id from questions where id=?').get(id);}finally{db.close();}
  if(row?.status==='sent'&&row.message_id){entry.status='answered';entry.answer_id=row.message_id;found=true;break;}
  if(row&&['failed','uncertain','busy','rate_limited'].includes(row.status))throw Error('Question reply incomplete: '+row.status);
  await pause(2000);
 }
 if(!found)throw Error('No automatic group answer receipt');
 writeFileSync(path,JSON.stringify(report));
}
report.status='sent';writeFileSync(path,JSON.stringify(report));console.log(JSON.stringify(report));
