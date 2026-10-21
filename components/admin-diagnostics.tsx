"use client";
import {useEffect,useState} from 'react';
import {act} from '@/lib/client';

type TraceEvent={id:string;occurred_at:string;stage:string;entity_id:string;phase:string;attempt:number;error_code?:string;duration_ms?:number;job_id?:string;article_id?:string;source_id?:string};
type Run={id:string;stage:string;status:string;started_at:string;duration_ms?:number;processed:number};
type Diagnostics={events?:TraceEvent[];runs?:Run[];next_cursor?:string};
type Filters={stage:string;day:string;entity_id:string};
export default function AdminDiagnostics({preview=false}:{preview?:boolean}){
 const empty:Filters={stage:'',day:'',entity_id:''};
 const [draft,setDraft]=useState(empty),[filters,setFilters]=useState(empty),[cursor,setCursor]=useState<string|null>(null);
 const [data,setData]=useState<Diagnostics|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(!preview);
 useEffect(()=>{
  if(preview)return;
  let cancelled=false;
  act('admin_diagnostics',{...filters,before_id:cursor}).then(d=>{if(!cancelled){setData(d);setError('');}}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;};
 },[preview,filters,cursor]);
 const events=data?.events||[],runs=data?.runs||[];
 return <article className="bi-card" aria-label="Historical diagnostics" aria-busy={loading}>
  <h3>Historical diagnostics</h3>
  <p className="bi-footnote">Search 14 days of pipeline transitions by UTC day, stage or job, article, source and event ID. Only IDs, timings and fixed error codes are recorded.</p>
  <form className="bi-diagnostic-filters" onSubmit={e=>{e.preventDefault();setLoading(true);setCursor(null);setFilters({...draft});}}>
   <label>Stage<select aria-label="Diagnostic stage" value={draft.stage} onChange={e=>setDraft({...draft,stage:e.target.value})}><option value="">All stages</option>{['discovery','collection','evaluation','notification'].map(s=><option key={s}>{s}</option>)}</select></label>
   <label>UTC day<input aria-label="Diagnostic UTC day" type="date" value={draft.day} onChange={e=>setDraft({...draft,day:e.target.value})}/></label>
   <label>Correlation ID<input aria-label="Diagnostic correlation ID" placeholder="Job, article, source or event UUID or request number" value={draft.entity_id} onChange={e=>setDraft({...draft,entity_id:e.target.value.trim()})} pattern="([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}|[0-9]{1,20})"/></label>
   <button className="secondary-button" disabled={loading||preview}>Search diagnostics</button>
  </form>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="table-scroll"><table><thead><tr><th>Time · local</th><th>Stage / phase</th><th>Correlation</th><th>Attempt</th><th>Duration</th><th>Error code</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{new Date(e.occurred_at).toLocaleString()}</td><td>{e.stage}<small className="cell-detail">{e.phase}</small></td><td><details><summary><code>{e.entity_id}</code></summary>{[['Job',e.job_id],['Article',e.article_id],['Source',e.source_id]].filter(([,id])=>id).map(([label,id])=><small className="cell-detail" key={label}>{label}: <code>{id}</code></small>)}</details></td><td>{e.attempt}</td><td>{e.duration_ms==null?'—':`${e.duration_ms} ms`}</td><td>{e.error_code||'—'}</td></tr>)}</tbody></table></div>
  {!events.length&&<p className="bi-empty">{loading?'Loading diagnostics…':'No recorded transitions match this search. Earlier history cannot be reconstructed.'}</p>}
  <div className="bi-controls"><button className="secondary-button" disabled={loading||!cursor} onClick={()=>{setLoading(true);setCursor(null);}}>Latest results</button><button className="secondary-button" disabled={loading||!data?.next_cursor} onClick={()=>{setLoading(true);setCursor(data?.next_cursor||null);}}>Older results</button><span className="subtle">Up to 100 transitions per page · default last 24 hours</span></div>
  <h4>Scheduled pipeline runs</h4><p className="bi-footnote">Latest 30 runs in the selected window. A successful cron trigger alone does not prove successful processing.</p>
  <div className="table-scroll"><table><thead><tr><th>Started · local</th><th>Trace ID</th><th>Stage</th><th>Result</th><th>Duration</th><th>Processed</th></tr></thead><tbody>{runs.map(r=><tr key={r.id}><td>{new Date(r.started_at).toLocaleString()}</td><td><code>{r.id}</code></td><td>{r.stage}</td><td>{r.status}</td><td>{r.duration_ms==null?'—':`${r.duration_ms} ms`}</td><td>{r.processed}</td></tr>)}</tbody></table></div>
 </article>;
}
