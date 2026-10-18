"""Enable only a previously verified fixed destination, preserving paired state."""
import os
from pathlib import Path
import re
import sqlite3
import tempfile


def configure_delivery(env_path, db_path, target):
    if not re.fullmatch(r"\d{5,30}(?:-\d{5,20})?@g\.us", target):
        raise RuntimeError("Invalid verified destination")
    env_path, db_path = Path(env_path), Path(db_path)
    if env_path.is_symlink() or not env_path.is_file() or db_path.is_symlink():
        raise RuntimeError("Invalid runtime paths")
    if not db_path.is_file():
        raise RuntimeError("Existing delivery store required")
    with sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True) as db:
        if db.execute("select count(*) from deliveries where phase<>'sent'").fetchone()[0]:
            raise RuntimeError("Reconcile outstanding deliveries before configuring")
        sent = db.execute("select count(*) from deliveries where phase='sent'").fetchone()[0]
    lines = env_path.read_text().splitlines()
    matches = [i for i, line in enumerate(lines) if line.startswith("WHATSAPP_GROUP_JID=")]
    if len(matches) != 1:
        raise RuntimeError("Expected one fixed destination setting")
    index = matches[0]
    current = lines[index].split("=", 1)[1].strip().strip('"\'')
    if current and current != target:
        raise RuntimeError("Refusing to replace an existing destination")
    if not current:
        metadata = env_path.stat()
        lines[index] = "WHATSAPP_GROUP_JID=" + target
        fd, temporary = tempfile.mkstemp(dir=env_path.parent, prefix=".bot-env-")
        try:
            with os.fdopen(fd, "w") as output:
                output.write("\n".join(lines) + "\n")
                output.flush(); os.fsync(output.fileno())
            os.chmod(temporary, metadata.st_mode & 0o777)
            os.chown(temporary, metadata.st_uid, metadata.st_gid)
            os.replace(temporary, env_path)
            directory = os.open(env_path.parent, os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
    return {"destination_configured": True, "previously_configured": bool(current), "confirmed_deliveries": sent}
