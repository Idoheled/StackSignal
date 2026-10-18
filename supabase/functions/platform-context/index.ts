import { readBoundedBody,signedHeaders,verifySignature } from '../_shared/whatsapp-protocol.ts';
const headers={'content-type':'application/json','cache-control':'no-store'};
Deno.serve(async request=>{
 if(request.method!=='POST'||request.headers.get('content-type')?.split(';')[0]!=='application/json')return new Response('{"error":"Unauthorized"}',{status:401,headers});
 try{
  const body=await readBoundedBody(request,1024),base=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const rpc=async(name:string,args:unknown)=>{const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'content-type':'application/json',apikey:key,authorization:'Bearer '+key},body:JSON.stringify(args)});if(!r.ok)throw Error('Database unavailable');return r.json();};
  const c=await rpc('ss_whatsapp_dispatch_configuration',{}),secret=Deno.env.get('WHATSAPP_WEBHOOK_SECRET')||c.whatsapp_webhook_secret;
  if(!await verifySignature(secret,'ops-context',body,request.headers))return new Response('{"error":"Unauthorized"}',{status:401,headers});
  const p=JSON.parse(body);
  if(!['latest_releases','health'].includes(p.operation)||!Number.isInteger(p.limit??7)||(p.limit??7)<1||(p.limit??7)>10)return new Response('{"error":"Invalid read-only request"}',{status:400,headers});
  const permitted=await rpc('ss_rate_limit',{keys:['platform-context'],max_count:120,window_seconds:60});if(!permitted)return new Response('{"error":"Please retry shortly"}',{status:429,headers});
  const context=await rpc('ss_platform_context',{item_limit:p.operation==='health'?1:p.limit??7});
  if(p.operation==='health')delete context.releases;
  const out=JSON.stringify(context);return new Response(out,{headers:{...headers,...await signedHeaders(secret,'ops-receipt',out)}});
 }catch{return new Response('{"error":"Platform context unavailable"}',{status:503,headers});}
});
