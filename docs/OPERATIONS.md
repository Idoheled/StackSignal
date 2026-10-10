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
| Collector | Active deployment, version 1; invocation secret not installed yet |
| Collector schedule | `stacksignal-collector`, `*/5 * * * *`, **inactive** |
| Optional AI/search budgets | Both zero |

## Completed and verified

- Application migrations applied once: `stacksignal_initial`, `team_library_import`, `provider_readiness`. The hosted extension migration `hosted_collector_runtime` is also applied. Remote migration timestamps were assigned by the deployment service and differ from source filenames; reconcile by name before using CLI migration commands.
- Administrator created and library imported on October 2. The same counts and mandatory password-change flag were checked on October 3.
- Public signup and anonymous identities disabled. Minimum password length 16 and current-password verification enabled. TOTP enabled; access tokens last one hour with refresh rotation. Application sessions are bounded to 12 hours.
- Auth Site URL is the exact private site origin. No wildcard redirects.
- Existing random session/collector secrets were preserved. Runtime environment revision 2 contains Supabase URL, legacy anon/service-role keys, APP_ORIGIN and SESSION_SECRET. Sensitive entries are masked server secrets.
- `pg_cron` and `pg_net` enabled. Collector URL and invocation secret stored in Vault under `stacksignal_collector_url` and `stacksignal_collector_secret`.
- The scheduler is prepared paused; setup is idempotent and does not reset an existing job.
- Anonymous article reads denied; internal `net`, `cron`, `vault` schemas rejected by the Data API. Live security advisor results are explained in SECURITY.md.

## Remaining activation steps

1. Add the existing `COLLECTOR_SECRET` from the local ignored setup file to Supabase Edge Function Secrets. Do not generate a different value; it must match Vault. Do not assume a dashboard session persisted across turns. Saving a new security credential through browser UI requires an action-time confirmation under the browser policy.
2. Invoke the collector once with its secret, inspect job/source outcomes and verify unauthorized calls remain denied. Then activate the existing Cron job. A successful HTTP response alone is not proof that every source worked.
3. Create a Cloudflare Turnstile Managed widget restricted to the exact site hostname. Cloudflare's dashboard returned a repeated verification error in this cloud browser after one reload and Google sign-in. No widget or keys were created; do not repeatedly retry or bypass that check.
4. Configure that widget in Supabase Auth CAPTCHA settings and add its site/secret keys to the site's runtime configuration. Redeploy to apply the environment revision. Remove the private preview flag once real authentication is configured.
5. Verify real username/password login, first password change, authenticator enrollment, invitations and role isolation. Password entry/change and authenticator enrollment must remain in the user's secure interface.
6. Complete the remaining integration/load/backup checks before onboarding the full team. The current Site's outer audience is still owner-only; team access needs an explicit audience decision or the documented standalone deployment.

## Private local state

The ignored `.env.setup` contains the existing integration credentials. The ignored `.bootstrap-credentials.txt` contains the temporary administrator password. Both have mode 0600. Do not print, commit, archive, upload as documents or regenerate them during continuation. Store final credentials in the owner's password manager and remove the temporary credential file after the first password change. The workspace is transient; this source checkpoint intentionally contains no recovery secrets.

## Honest current status

The private preview is available. Live login and automatic discovery are **not yet ready**. No scheduled collection has run, no live source-health success is claimed, and the 100-user target has not yet been load-tested. Existing content and provider accounts must be preserved on continuation.

## October 10 resume

- Local source, ignored credential files, the private Site and runtime environment revision 2 were preserved. No accounts, imports, migrations or secrets were recreated.
- Supabase reported `INACTIVE`, and SQL reads timed out. The existing project was resumed through the provider connection; initially it reported `COMING_UP`. Check for `ACTIVE_HEALTHY` and verify the existing data before further database changes.
- Plugin Management returned no installable Cloudflare plugin. The result is not an exhaustive statement about every third-party plugin; no unknown connector was installed or granted credentials.
- The Cloudflare login was not opened or retried. Phone Chrome can be used for the one-time widget setup; there is no requirement to switch to a PC for that action.
- Keep Sol 6.1 High for routine implementation and provider setup. Recommend an explicit user switch to Astra 6 for a final deep security/architecture review if that remains useful before onboarding. Do not delegate or change models automatically.
