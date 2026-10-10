# StackSignal continuation checkpoint — October 10, 2026

Check live state before repeating setup. This file contains no credentials.

## Existing resources

| Resource | Current value |
|---|---|
| Private site | https://stacksignal.idoheled456.chatgpt.site |
| Site project | `appgprj_6ab7758753248191afc68fe0a1584d9d` |
| Supabase project | `plbjscbpvfozqvexmqhk`, Frankfurt, Free |
| Supabase organization | Existing organization `cvgjoziulovsxkrotbhr` |
| Administrator | `administrator`, first password change required |
| Imported content | 136 articles, 136 saves, 29 folders, 57 source watches |
| Collector | Active version 1; invocation secret installed and matches Vault |
| Collector schedule | `stacksignal-collector`, `*/5 * * * *`, active |
| Optional AI/search budgets | Both zero; no Gemini or Tavily credentials installed |
| Turnstile | Managed widget `0x4AAAAAAFS_RfYW2IMG-0bL`, exact Site hostname only |

## Completed and verified

- Existing account, library, secrets and provider resources preserved; no repeat import or bootstrap. Supabase resumed from INACTIVE to ACTIVE_HEALTHY.
- Migrations: `stacksignal_initial`, `team_library_import`, `provider_readiness`, `hosted_collector_runtime`. Remote timestamps differ from source filenames; reconcile by name before CLI migration commands.
- Public signup and anonymous identities disabled. Minimum password length 16, current-password verification and TOTP enabled. Application sessions bounded to 12 hours. Auth Site URL is the exact private origin.
- Supabase Auth CAPTCHA enabled with the existing Turnstile widget. Direct password endpoint rejects missing and invalid tokens (`captcha_failed`), with no invalid-secret response. A genuine human challenge/login remains to be tested.
- Runtime environment revision 3 adds Turnstile site/secret keys and removes STACKSIGNAL_PRIVATE_PREVIEW_ORIGIN. Secrets remain server-only. This source version must be deployed with revision 3; verify the deployment response and live /api/status.
- Collector custom invocation secret installed through Management API and its SHA-256 matches the Vault value. Unauthorized invocation returns 401; authenticated invocation returns 200. Two manual runs completed seven jobs each. KServe release watch succeeded at 10:16:42 UTC. Imported metadata fetching also succeeded; HTTP 429 on an upstream source remains queued for bounded retry.
- To validate one live watch before activation, its existing pending job was moved ahead of the metadata backlog. No content or job was fabricated. All other sources still require their first poll; initial enrichment will drain over multiple scheduled runs.
- Existing Cron job activated after collector validation. It invokes the existing Edge Function through pg_net using Vault credentials. Verify scheduled execution and HTTP response separately; a queued HTTP request is not proof of collection success.
- Anonymous article access denied; internal net, cron, vault schemas unexposed to Data API. See SECURITY.md for limits and advisor results.
- Recovery/registration Turnstile verification requires HTTP success, strict boolean success, exact hostname and matching action. Login delegates CAPTCHA verification once to Supabase Auth to avoid token replay. Seventeen security/database/knowledge tests passed.

## Remaining checks and owner actions

1. Verify this deployment uses runtime revision 3, configured login, disabled preview and anonymous data denial.
2. Observe an actual Cron invocation and inspect source errors; do not claim all 57 sources are healthy from one successful watch.
3. Owner performs real username/password login, first password change and authenticator enrollment through the Site. Then test invitations and role isolation with real accounts. Never request authenticator seeds/codes in chat.
4. Complete backup restore, traffic/load and independent security review before full-team onboarding. Current outer hosting audience remains owner-only; team access requires an explicit audience decision or standalone deployment. App invitations alone do not bypass the hosting gate.
5. Revoke temporary Cloudflare and Supabase setup API tokens once provider work is complete. Preserve runtime keys required by the application. Store credentials in the owner's password manager.

## Private local state

Ignored .env.setup and .bootstrap-credentials.txt have mode 0600. Do not print, commit, archive, upload as documents or regenerate their contents. Remove the temporary administrator credential file after first password change. The workspace is transient; this checkpoint intentionally contains no recovery secrets.

## Cloudflare setup and model choice

Official agent-setup instructions installed 16 skills and registered the MCP server in the existing Codex configuration. CLI OAuth uses a workspace-local callback and is not authenticated. Scoped REST access is verified; MCP authentication is not. No installable Cloudflare plugin was found by Plugin Management. Do not retry the cloud-browser dashboard verification loop.

Keep Sol 6.1 High for routine implementation/setup. An explicit switch to Astra 6 may help with a final deep security/architecture review. Do not change models or delegate automatically. No PC is needed for current owner login/setup checks.
