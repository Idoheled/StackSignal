#!/usr/bin/env python3
"""Read-only, bounded bootstrap diagnostics. Never read configuration/secrets."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

def inspect():
    result={"status":"bootstrap_diagnostic","git":bool(shutil.which("git"))}
    for label,path in {"node":"/opt/node/bin/node","openclaw":"/opt/node/bin/openclaw",
        "ollama":"/usr/local/bin/ollama","caddy":"/usr/bin/caddy",
        "bootstrap_complete":"/etc/stacksignal/bootstrap-complete"}.items():
        result[label]=Path(path).exists()
    logs=sorted(Path("/root/.npm/_logs").glob("*debug*"),key=lambda x:x.stat().st_mtime)
    if logs:
        with logs[-1].open("rb") as stream:
            stream.seek(max(0,logs[-1].stat().st_size-32768))
            text=stream.read(32768).decode(errors="replace")
        result["npm_error_codes"]=[code for code in ("ENOENT","EACCES","EBADENGINE","ECONNRESET","ENOTFOUND","ENOMEM","EINTEGRITY","E404","E401","ETARGET","EUSAGE") if code in text]
        result["npm_missing_git"]="spawn git" in text.lower() and "ENOENT" in text
    if result["node"]:
        env={**os.environ,"PATH":"/opt/node/bin:/usr/local/bin:/usr/bin:/bin"}
        version=subprocess.run(["/opt/node/bin/npm","--version"],env=env,capture_output=True,text=True,timeout=15)
        if re.fullmatch(r"\d+\.\d+\.\d+\s*",version.stdout):result["npm_version"]=version.stdout.strip()
    return result

if __name__=="__main__":
    print(json.dumps(inspect()))
