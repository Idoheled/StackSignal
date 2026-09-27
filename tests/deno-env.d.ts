// Minimal host declarations for static checking; the collector runs on Supabase's Deno runtime.
declare namespace Deno {
 const env: {get(name:string):string|undefined};
 function resolveDns(query:string,type:'A'):Promise<string[]>;
 function serve(handler:(request:Request)=>Promise<Response>):unknown;
}
