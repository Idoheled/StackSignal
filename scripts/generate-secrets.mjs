import { writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env.setup"))
  throw new Error(
    ".env.setup already exists. Preserve existing session and collector secrets.",
  );
const session = randomBytes(32).toString("base64url"),
  cron = randomBytes(32).toString("hex");
writeFileSync(
  ".env.setup",
  `# Local setup only. Never commit or share this file.\nSUPABASE_URL=\nSUPABASE_ANON_KEY=\nSUPABASE_SERVICE_ROLE_KEY=\nAPP_ORIGIN=\nTURNSTILE_SITE_KEY=\nTURNSTILE_SECRET_KEY=\nSESSION_SECRET=${session}\nCOLLECTOR_SECRET=${cron}\n# Optional collector integrations; leave empty to stay API-independent.\nGEMINI_API_KEY=\nGEMINI_MODEL=\nTAVILY_API_KEY=\nGITHUB_READ_TOKEN=\nCOLLECTOR_ALLOWED_HOSTS=\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Created .env.setup with cryptographically random session and collector secrets. Fill the blank required values locally.",
);
