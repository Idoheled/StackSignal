import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateWhatsAppReport } from "../bot/deploy/verify-whatsapp-plugin.mjs";

function fixture() {
  const root=mkdtempSync(join(tmpdir(),"stacksignal-plugin-")),state=join(root,"state"),directory=join(state,"npm","whatsapp");
  mkdirSync(directory,{recursive:true});
  writeFileSync(join(directory,"package.json"),JSON.stringify({name:"@openclaw/whatsapp",version:"2026.10.3"}));
  writeFileSync(join(directory,"index.ts"),"export {};\n");
  const report={plugin:{id:"whatsapp",version:"2026.10.3",source:join(directory,"index.ts"),status:"disabled"},
    install:{source:"npm",resolvedName:"@openclaw/whatsapp",resolvedVersion:"2026.10.3",spec:"@openclaw/whatsapp@2026.10.3",installPath:directory}};
  return {root,state,directory,report,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test("modern plugin-index inspection verifies a disabled pinned package without JSON install records",()=>{
  const f=fixture();
  try {assert.deepEqual(validateWhatsAppReport(f.report,f.state),{status:"whatsapp_plugin_verified",version:"2026.10.3"});}
  finally {f.cleanup();}
});

test("plugin verification rejects missing or changed package provenance",()=>{
  const f=fixture();
  try {
    for(const install of [undefined,{...f.report.install,source:"path"},{...f.report.install,resolvedName:"@unknown/whatsapp"},
      {...f.report.install,resolvedVersion:"2026.10.4"},{...f.report.install,spec:"@openclaw/whatsapp@latest"}])
      assert.throws(()=>validateWhatsAppReport({...f.report,install},f.state),/plugin_provenance/);
    writeFileSync(join(f.directory,"package.json"),JSON.stringify({name:"@openclaw/whatsapp",version:"2026.10.4"}));
    assert.throws(()=>validateWhatsAppReport(f.report,f.state),/plugin_package/);
  } finally {f.cleanup();}
});

test("plugin verification rejects managed-looking symlinks and entry points outside the service state",()=>{
  const f=fixture();
  try {
    const outside=join(f.root,"unmanaged");mkdirSync(outside);
    writeFileSync(join(outside,"index.ts"),"export {};\n");
    symlinkSync(outside,join(f.state,"shadow"),"dir");
    assert.throws(()=>validateWhatsAppReport({...f.report,install:{...f.report.install,installPath:join(f.state,"shadow")}},f.state),/plugin_path/);
    assert.throws(()=>validateWhatsAppReport({...f.report,plugin:{...f.report.plugin,source:join(outside,"index.ts")}},f.state),/plugin_path/);
  } finally {f.cleanup();}
});
