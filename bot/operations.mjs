import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readBoundedBody,signedHeaders,verifySignature} from '../supabase/functions/_shared/whatsapp-protocol.ts';
const contextURL='https://plbjscbpvfozqvexmqhk.supabase.co/functions/v1/platform-context';
export async function platformContext(operation='latest_releases',limit=7,{send=fetch,secret=process.env.WHATSAPP_WEBHOOK_SECRET||'',origin=process.env.WHATSAPP_APP_ORIGIN||''}={}){
 if(!['latest_releases','health'].includes(operation)||!Number.isInteger(limit)||limit<1||limit>10)throw Error('Invalid context request');
 const body=JSON.stringify({operation,limit});
 const r=await send(contextURL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),headers:{'content-type':'application/json',...await signedHeaders(secret,'ops-context',body)},body});
 const text=await readBoundedBody(r,24000);
 if(!r.ok||!await verifySignature(secret,'ops-receipt',text,r.headers))throw Error('Platform context unavailable');
 const p=JSON.parse(text);if(!Number.isFinite(Date.parse(p.checked_at))||Math.abs(Date.now()-Date.parse(p.checked_at))>300000)throw Error('Stale platform context');
 if(operation==='latest_releases'){
  if(!Array.isArray(p.releases)||p.releases.length>limit)throw Error('Invalid releases');
  for(const a of p.releases)if(!/^[a-f0-9-]{36}$/i.test(a.id)||typeof a.title!=='string'||a.title.length>500||a.ui_url!==origin+'/?article='+a.id||!Number.isFinite(Date.parse(a.discovered_at)))throw Error('Invalid release context');
 }
 return p;
}
export function releaseRequest(question){
 if(!/(?:releases?|ריליס|גרס|שחרור)/i.test(question)||!/(?:latest|last|recent|אחרונ|שנכנס)/i.test(question))return null;
 const number=question.match(/\b(\d{1,2})\b/)?.[1];
 const requested=number?Number(number):/שבעת|שבע|seven/i.test(question)?7:/חמש|five/i.test(question)?5:/שלוש|three/i.test(question)?3:7;
 return Math.max(1,Math.min(10,requested));
}
export function formatReleases(context,question){
 const he=/[\u0590-\u05ff]/.test(question);
 const intro=he?'הנה, חסכתי לך כמה קליקים, עצלן מוכשר. אלה ה־releases המאושרים האחרונים לפי מועד כניסתם לפלטפורמה:':'Fine, I did the clicking for you, genius. Latest approved releases by discovery time:';
 if(!context.releases.length)return '🤖 *Columbus · קולומבוס*\n\n'+(he?'כרגע אין releases מאושרים להצגה. אני לא אמציא גרסאות בשביל הרושם.':'No approved releases are available. I refuse to invent versions for dramatic effect.');
 const rows=context.releases.map((a,i)=>`${i+1}. *${a.title.replace(/[*_~`@]/g,'').replace(/[\r\n]/g,' ')}*\n${he?'נכנס':'Discovered'}: ${a.discovered_at}\n${a.ui_url}`);
 return '🤖 *Columbus · קולומבוס*\n\n'+intro+'\n\n'+rows.join('\n\n')+'\n\n'+(he?'מוצג ה־release המאושר הנוכחי לכל פרויקט; לא תאריכי פרסום מומצאים.':'One current approved release per project; discovery order, not invented publication dates.');
}
export function runtimeStatus(base,{now=Date.now()}={}){
 const out={checked_at:now,connected:false,heartbeat_at:0,questions:{answered_24h:0,failed_1h:0,uncertain:0,stuck:0,busy_1h:0,rate_limited_1h:0},deliveries:{}};
 const path=join(base,'columbus.sqlite');
 if(existsSync(path)){const db=new DatabaseSync(path,{readOnly:true});try{
  if(db.prepare("select 1 from sqlite_master where name='runtime_state'").get()){const row=db.prepare('select connected,heartbeat_at from runtime_state where singleton=1').get();if(row){out.connected=row.connected===1;out.heartbeat_at=row.heartbeat_at;}}
  out.questions=db.prepare("select sum(case when status='sent' and created_at>? then 1 else 0 end) answered_24h,sum(case when status='failed' and created_at>? then 1 else 0 end) failed_1h,sum(case when status='uncertain' then 1 else 0 end) uncertain,sum(case when status in ('accepted','sending') and created_at<? then 1 else 0 end) stuck,sum(case when status='busy' and created_at>? then 1 else 0 end) busy_1h,sum(case when status='rate_limited' and created_at>? then 1 else 0 end) rate_limited_1h from questions").get(now-86400000,now-3600000,now-240000,now-3600000,now-3600000);
 }finally{db.close();}}
 const delivery=join(base,'deliveries.sqlite');if(existsSync(delivery)){const db=new DatabaseSync(delivery,{readOnly:true});try{out.deliveries=Object.fromEntries(db.prepare('select phase,count(*) n from deliveries group by phase').all().map(r=>[r.phase,r.n]));out.deliveries.stuck=db.prepare("select count(*) n from deliveries where (phase in ('generating','sending') and updated_at<?) or(phase='queued' and available_at<?)").get(now-240000,now-900000).n;}finally{db.close();}}
 return out;
}
export function formatIncident(p){return ['🤖 *Columbus · קולומבוס*',p.phase==='recovery'?'🟢 Recovered. Even platforms deserve a comeback.':'🚨 Platform problem. The gremlins have been located.',`*${p.code.replaceAll('_',' ')}*`,p.summary,`Observed: ${p.observed_at}`,`Administrator health dashboard: ${p.ui_url}`].join('\n\n');}
export async function watchdog(store,{secret,origin,now=Date.now(),getContext=platformContext}={}){
 store.db.exec("create table if not exists watchdog(code text primary key,id text not null,first_seen integer not null,notified integer not null default 0)");
 let unhealthy=false;
 try{const p=await getContext('health',1,{secret,origin});unhealthy=typeof p.monitor_checked_at!=='string'||!Number.isFinite(Date.parse(p.monitor_checked_at))||now-Date.parse(p.monitor_checked_at)>20*60000;}catch{unhealthy=true;}
 const code='platform_monitor_unavailable';let row=store.db.prepare('select * from watchdog where code=?').get(code);
 if(unhealthy){
  if(!row){store.db.prepare('insert into watchdog(code,id,first_seen) values(?,?,?)').run(code,randomUUID(),now);return;}
  if(!row.notified&&now-row.first_seen>=5*60000){store.accept({id:row.id,payload:{version:1,kind:'platform_incident',code,phase:'open',summary:'The platform database/context API or scheduled health monitor is unavailable or stale. The bot is still online; administrator investigation is needed.',observed_at:new Date(row.first_seen).toISOString(),ui_url:origin+'/?view=admin'}},now);store.db.prepare('update watchdog set notified=1 where code=?').run(code);}
 }else if(row){
  if(row.notified&&store.get(row.id)?.phase!=='sent')return;
  if(row.notified)store.accept({id:randomUUID(),payload:{version:1,kind:'platform_incident',code,phase:'recovery',summary:'The platform context API and scheduled health observations are responding again.',observed_at:new Date(now).toISOString(),ui_url:origin+'/?view=admin'}},now);
  store.db.prepare('delete from watchdog where code=?').run(code);
 }
}
