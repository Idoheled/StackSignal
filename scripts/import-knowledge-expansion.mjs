#!/usr/bin/env node
// Explicit administrator operation, never invoked by deployment or the website.
import {knowledgeExpansionPayload} from '../lib/knowledge-expansion.ts';
process.loadEnvFile('.env.setup');
const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base||'') || !key) throw new Error('Configure server-side setup credentials first.');
const response=await fetch(base+'/rest/v1/rpc/ss_import_team',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({payload:knowledgeExpansionPayload()}),signal:AbortSignal.timeout(45000)});
if(!response.ok) throw new Error('Additive import failed ('+response.status+'); check the migration and administrator setup.');
console.log(JSON.stringify(await response.json()));
