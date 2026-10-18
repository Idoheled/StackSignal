"""Reproducible, version/hash-guarded adapter for the pinned WhatsApp socket.
No arbitrary vendor upgrade or policy-by-prompt: filtering precedes decryption.
"""
import hashlib
import os
from pathlib import Path

ORIGINAL_SHA256='c54b159b54b59812995e90a02bcd38f543fe54a82ccc0dcd43c988bc2eeb6c93'
IMPORT="import { installColumbusBoundary } from '/opt/stacksignal/bot/columbus-runtime.mjs';\n"

def patched_source(original):
    if hashlib.sha256(original.encode()).hexdigest()!=ORIGINAL_SHA256:
        raise RuntimeError('Pinned WhatsApp session source differs; refuse unsafe patch')
    replacements={
        '\t\tsyncFullHistory: false,':'\t\tsyncFullHistory: false,\n\t\tshouldSyncHistoryMessage: () => false,\n\t\tshouldIgnoreJid: (jid) => jid !== process.env.WHATSAPP_GROUP_JID,',
        '\t\tfireInitQueries: receiveMode !== "directory",':'\t\tfireInitQueries: false,',
        '\tif (receiveMode === "directory") for (const event of [':'\tinstallColumbusBoundary(sock, { enabled: receiveMode !== "directory" && process.env.COLUMBUS_ENABLED === "true" });\n\tif (receiveMode === "directory") for (const event of [',
    }
    for old,new in replacements.items():
        if original.count(old)!=1:raise RuntimeError('Pinned socket contract changed')
        original=original.replace(old,new)
    return IMPORT+original

def patch(path):
    path=Path(path)
    if path.is_symlink() or not path.is_file():raise RuntimeError('Invalid plugin source path')
    backup=path.with_name(path.name+'.stacksignal-original')
    # The managed package belongs to the service user; root maintenance must
    # not replace a private readable source file with an unreadable root file.
    owner=path.parent.stat();mode=path.stat().st_mode&0o777
    def readable(file):
        os.chown(file,owner.st_uid,owner.st_gid);file.chmod(mode)
    readable(path)
    current=path.read_text()
    if backup.exists():
        readable(backup)
        expected=patched_source(backup.read_text())
        if current==expected:return False
        if current!=backup.read_text():raise RuntimeError('Installed boundary differs from reviewed source')
        path.write_text(expected);return True
    expected=patched_source(current)
    with backup.open('x') as output:output.write(current)
    readable(backup)
    temporary=path.with_name(path.name+'.stacksignal-new')
    temporary.write_text(expected);readable(temporary);temporary.replace(path)
    return True
