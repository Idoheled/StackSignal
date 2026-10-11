# StackSignal operations checkpoint — October 11, 2026

## Preserve this deployment

- Team website: https://stacksignal.stacksignal-idoheled.workers.dev — deployed on the owner's existing Cloudflare account `49c94d7ba2a9124b3e0ddea7a329ad05`, Worker `stacksignal`.
- Website: https://stacksignal.idoheled456.chatgpt.site
- Sites project: `appgprj_6ab7758753248191afc68fe0a1584d9d`. The hosting audience is still custom, owner-only. Do not broaden it or create another project when resuming.
- Supabase Free project: `plbjscbpvfozqvexmqhk`, Frankfurt, existing organization `cvgjoziulovsxkrotbhr`.
- Runtime environment revision 3 holds the app origin, encrypted-session key, Supabase keys and Turnstile keys. The private-preview flag is absent. Never print or regenerate runtime secrets during continuation.
- Existing owner `administrator` is active, has changed the temporary password, and completed a fresh TOTP enrollment at 10:44–10:45 UTC on October 10. The obsolete temporary administrator credential file was removed. Do not bootstrap/reset this account.
- The original import contains 136 links, 136 bookmarks, 29 folders and 57 watches. It is immutable and already applied. Collection has since expanded the article count. Do not re-run the import with a changed batch payload.

## Current evaluation checkpoint — October 11

The semantic-evaluation feature is deployed in collector **version 13**. The `conservative_evaluation` migration remains applied. The owner confirmed the Google API project is on the **Free tier**, and requested `gemini-flash-latest` instead of the originally pinned Lite model. The server key remains in Supabase function secrets; the alias follows Google's Flash releases automatically. Keep that project on the Free tier: request caps are usage controls, not billing controls.

**Live configuration: Apply (`rerank`), four attempts per rolling 24 hours, 100 per UTC month, with month-aware pacing.** The owner saved Apply through the administrator profile; it is persistent in PostgreSQL and survives redeployments. The frontend deployment does not reseed preferences or reset usage. Verification at `2026-10-11T10:48Z`: an authenticated collector invocation returned HTTP 200, processed eight normal jobs and completed the first real semantic assessment. Health reports `active`, no error, and resolved model **`gemini-3.8-flash`**. The private ledger records exactly one attempt in both day and month windows. The response passed structured-output and exact-evidence validation and was saved on the article and in administrator comparisons. That initial comparison did not change its feed score; subsequent confident judgments run under the owner's Apply preference.

The first comparison was an exploratory LLM-security snippet: rules score 56, semantic score 10, high confidence, introductory/tangential. Its reason identified the absence of low-level engineering or infrastructure detail. This verifies live generation, parsing and persistence; one example does not establish overall ranking quality. Continue reviewing Health judgments under the owner's Apply setting; switch to Compare if further calibration is needed. The 650-token cap and low thinking were accepted by the live provider. Google's returned model version is retained with each comparison for future alias changes.

All 30 tests and application/collector typechecks passed for this change. Documentation links are checked locally before publication. The tests cover the alias endpoint, low thinking, model-version persistence, cache, privacy boundaries, evidence validation, provider cooldown, saved Apply persistence, month/leap-year rollover and pacing. Eligible items no longer expire after seven days; the oldest 50 pending public inputs form the candidate window. Health now reports eligible, reviewed, pending and failed counts and the next paced opportunity. Failures are flagged for inspection rather than automatically retried. GitHub Actions performs production build, 24 responsive checks and Cloudflare deployment after the main push; consult its matching commit run for the final result. Accounts, saved links, notes, folders, watches and collection schedules were preserved. See [evaluation architecture and activation](GEMINI_EVALUATION.md).

Historical checks at `2026-10-11T10:20Z`: 61 active watches and 20 web queries were preserved; 63 public excerpts were available. Anonymous and authenticated roles could not call the reservation RPC; the service role could. The private ledger was RLS-enabled without client policies. Collector authentication returned 401 without its secret and 200 with it. Main commit `61cb8e7805bc67f2fdeda5cd6e73e9935b7a312d` passed both Quality and Production in [Actions run 38131813140](https://github.com/Idoheled/StackSignal/actions/runs/38131813140). The subsequent key-only checkpoint at 10:38Z installed the key with generation paused and zero attempts pending the owner's Free-tier confirmation. Those earlier inactive states are superseded by the live evaluation above. The first successful comparison remains historical: enabling Apply does not retroactively rerank it or spend another API call.

At `2026-10-11T11:16Z`, the pacing/coverage verification returned HTTP 200 and processed eight normal jobs with no further generation: ledger usage remained one attempt. The saved mode remained `rerank`; health reported `pacing_wait`, next opportunity `2026-10-11T16:48:30Z`, and a dated snapshot of 119 eligible inputs: one reviewed, 118 pending, zero failed. Counts can continue increasing. This backlog exceeds one month's 100-attempt budget; full AI review within that month is not promised. The small final collector update additionally compares source fields independent of JSONB key order, preventing unnecessary cache invalidation. No Google quota values were supplied; verify project RPM/TPM/RPD before claiming provider headroom.

## Web discovery checkpoint — historical pre-evaluation status

Tavily web search is active through collector version 7. The saved profile contains 20 web queries with an 800-request monthly ceiling and a hard 24-request daily ceiling. All 20 jobs in the first daily sweep completed and stored 86 references; the latest search success at this checkpoint is `2026-10-11T07:35:03.563Z`. The five-minute Cron and 61 active watches are intact. Gemini remains disabled. Counts and timestamps are dated evidence; use Administration → Health for current state. See [activation evidence below](#tavily-web-search-activation--october-11).

## Security review and discovery release — historical pre-search checkpoint

The `security_review` migration is already applied. It requires an existing, unexpired provider Auth session in addition to the app session, checks a currently verified TOTP factor for writers, and repairs expired-trash cleanup of bookmarks.

The `discovery_radar` migration is now applied. It adds release-channel and watch-priority controls, source revisions, confirmation-protected watch deletion, profile merging/validation, fair job claims, duplicate-safe job enqueueing, service-only aggregate tag feedback and release/radar feed modes. It preserves existing accounts, folders, saved links, notes and read states. It also adds four validated publication feeds (arXiv distributed systems/machine learning, PyTorch, NetBox), bringing the registry to 61 sources.

Collector version 6 was active at this checkpoint, with custom 256-bit invocation authentication (`verify_jwt=false` is intentional; the handler requires the collector secret). Its bundle included the new relevance and source configuration modules. Stable releases were the default; public project discovery ran daily without an API key, with eight initial editable queries. Gemini and Tavily calls were disabled then (ceilings zero, no API keys assumed). Source checks ran on the existing `stacksignal-collector` Cron job every five minutes using Vault credentials. Publisher quotas deferred work without consuming retry attempts. The later web-search activation supersedes this status.

Twenty-two automated tests passed: real PGlite migration/RLS/permission tests; invite and MFA/session safeguards; note isolation; watch lifecycle; release/date semantics; deduplication; queue fairness; and mocked collector authentication, quota and discovery flows. App and collector TypeScript checks passed. The production build passed, and public asset inspection confirmed the private reference catalog stays server-side. Security headers now use per-response script nonces. See SECURITY.md for remaining development-tool advisories and verification limits.

The `source_watch_compatibility` migration is also applied. GitHub watches with legacy pagination parameters and different repository casing have one identity. Collection uses up to five pages of 20 releases, falling back to pages of 10 when necessary; each response retains the 2 MB size limit. Common release-candidate tags are recognized even when the publisher omits the prerelease flag. Current channel settings govern suggestions and unread alerts; existing archived/saved items are retained. The migration attached watch provenance to 116 existing releases and labeled six prereleases, preserving all 408 articles, 136 bookmarks, 29 folders and 61 sources at the 20:28 UTC checkpoint. Old queued analysis also respects the current stable-release setting.

Source and deployment IDs for this release are available from Sites version history; always reconcile the current live version and Git status before repeating publication. Live migration timestamps may differ from local filenames; reconcile by migration name, not by blindly pushing all local migrations.

## What the owner can do now

- Discover → This week / Releases / New to radar / Updated docs / All discoveries.
- Administration → Coverage: add or edit a source, paste a GitHub repository URL, choose stable/prerelease, priority and interval, pause/resume or remove a watch. Removing a watch keeps its library content.
- Administration → Coverage: edit the public repository queries, team interests, topic weights and minimum match score. Queries must contain generic public terms, not internal addresses or secrets.
- Administration → Health & audit: inspect delayed sources, failed metadata jobs, daily repository search status and request budgets. Individual upstream failures do not mean the whole collector stopped.
- Helpful / Not relevant feedback affects personal ranking; future analysis also uses bounded technical-tag feedback. Private notes and raw chats are not sent to external models/search providers.

## Remaining operating decisions

1. Team access uses the standalone Cloudflare URL above with application invitations, username/password and required writer MFA. The owner-only Sites hosting gate remains unchanged. The owner still needs to confirm a real login on the new URL, followed by invitation acceptance with a second account.
2. Confirm the interface on the owner's phone after publication. Browser automation is unavailable in this managed workspace; production build, HTTP checks and actual collector/database checks are used instead. Team invitation acceptance still needs a real second account.
3. Backup restoration, independent penetration testing and 100-user load behavior have not been certified. The free project has no uptime guarantee. Review storage usage and source freshness regularly.
4. Supabase's paid leaked-password database feature is not enabled under the zero-spend requirement. The app enforces length/common-pattern checks and writer MFA. Full-web/semantic AI services remain optional and have separate API quotas; a Gemini consumer subscription is not an unlimited API entitlement.
5. Revoke temporary Cloudflare/Supabase setup API tokens once provider setup work is complete; retain the distinct runtime keys used by the app. Keep account recovery material in the owner's password manager.
6. The next chat/link import should extract public technical sources, deduplicate them and use a new immutable import key. Preserve administrator-edited preferences and watch states. Do not import interpersonal messages or internal topology.

## Continuation guidance

Use the Sites source helper with a fresh short-lived credential. Do not print or persist the credential. Read only needed state, preserve the existing audience, test changes, then publish the exact pushed commit. Ignored `.env.setup` contains runtime secrets; it must stay out of Git, artifacts, logs and responses. No cloud-browser Cloudflare login attempts are needed: scoped provider APIs have been used successfully.

The owner selected Astra 6 for this security/architecture pass. Sol 6.1 High is sufficient for routine source imports and UI maintenance; do not switch models or spawn agents automatically.

## October 11 continuation

The overnight check found 470 articles and five release watches failing because the previous 100-item response exceeded the collector size limit. Collector version 6 fixes this with bounded pagination and smaller-page fallback, including oversized later pages. Completed watches use a seven-day overlap instead of repeatedly paging through older releases; initial watches retain the bounded 90-day lookback. Release analysis text is capped at 12,000 characters. The first-page ETag is saved only after all required pages succeed. Twenty-two tests pass, including prerelease-heavy pagination and payload-limit recovery. The live recovery processed 19 jobs; some watches reached the existing free hourly GitHub budget and are deferred automatically. Three superseded queued scans were removed; saved content was unaffected.

The owner updated the temporary Cloudflare token permissions on October 11. The account had no Workers subdomain or existing Worker. The API created `stacksignal-idoheled`; Wrangler deployed `stacksignal` from source commit `a57159ddc100be2dc6d1abeba00df03d654e5546`. The standalone production bundle is approximately 308 KiB gzipped, with 31 static assets. No paid plan, database, bucket or queue was created. The original Sites audience remains owner-only.

Seven runtime secrets were uploaded through stdin. The standalone APP_ORIGIN is the exact Workers URL above. The existing Turnstile widget now permits both exact hostnames; its secret and challenge settings were preserved. Supabase Auth's Site URL points to the team website and its redirect allowlist contains both exact origins. All other Auth settings were checked unchanged: signup disabled, minimum password length 16, current-password verification enabled, Turnstile enabled and TOTP enabled. Email-based password-change reauthentication remains disabled because username accounts have no mailbox. Existing accounts, passwords, MFA factors and sessions were not reset.

Live HTTP checks passed after HTTPS propagation: configured status, preview disabled, anonymous API reads rejected with 401, cross-origin login rejected with 403, missing challenge rejected with 400, and login HTML contains no imported catalog. Security headers and no-store responses are present; all 20 server-rendered script tags carry the response CSP nonce. Public asset inspection also passed. Automated requests using Python's default user-agent encountered an upstream 403; requests using a normal browser user-agent reached the application. This is distinct from the application's own JSON permission errors. Browser automation is unavailable; actual human Turnstile completion, login/MFA and a second user's invitation still require owner verification.

The active Cloudflare deployment is `457ac00e-27ae-41fd-b4b7-671fe493c1f9`, version `cda9e452-372d-454b-ad9b-6a61b7a3dd39`, deployed at 04:34:27 UTC on October 11 after the runtime-secret upload. The token cannot read account subscriptions (403); no subscription or billing mutation was performed. Do not upgrade to a paid plan during continuation.

The live database remains at 472 articles, 136 bookmarks, 29 folders and 61 sources at this checkpoint. The existing five-minute collector schedule is independent of frontend hosting and was preserved.

For future standalone updates, build with `pnpm build:standalone`, then deploy using the generated `dist/server/wrangler.json`, the exact account ID and a scoped token passed through the process environment. Keep runtime secrets out of argv/logs/Git and preserve them on deployment. Never upload the owner-only preview flag. For a Sites update, rebuild normally with the Sites helper; a standalone build is not a Sites artifact. After owner login is confirmed, revoke the temporary setup tokens or narrow the Cloudflare token to Editor on this Worker. See https://developers.cloudflare.com/workers/authorization/workers/ .


## Mobile layout and repository automation checkpoint

The owner confirmed successful login on the team Cloudflare URL. The responsive update wraps unbroken article titles, tags and evidence; prevents flex children from widening the feed; and makes the detail drawer fill the phone viewport with independent scrolling, safe-area padding and a reachable 44 px close button. Closing restores focus to the opener when it remains connected. Phone form controls use 16 px text to avoid automatic iOS input zoom. Laptop details retain a bounded side panel.

The repository now includes architecture, development, deployment, contribution and security documentation, Mermaid diagrams, code owners, issue/PR templates and Dependabot settings. The main/PR workflow performs both type checks, policy/collector tests, standalone build, public-asset checks and 21 responsive scenarios across Chromium, Firefox and WebKit before production deployment. It deploys the same verified artifact to the existing Worker, preserves runtime secrets and runs live security smoke checks. It does not deploy database migrations or the collector.

The 22 existing automated tests, both type checks and production build passed during preparation. Browser scenarios were listed successfully but have not run: this managed workspace does not provide supported browser automation. Physical Android/iPhone and laptop verification remains necessary; do not describe browser coverage as passed until a supported runner executes it.

The owner connected GitHub and authorized publication to https://github.com/Idoheled/StackSignal . Reads confirmed this public repository was empty. The integration rejected the first source write with HTTP 403, “Resource not accessible by integration”; no GitHub source commit was created. The local origin points to the owner's repository. Publishing there and configuring Actions secrets/environments require working repository write/settings authorization. The temporary broad Cloudflare setup token has not been copied to a permanent CI secret; production automation should use a token scoped to Editor on the existing Worker. Check actual GitHub files, workflow runs and live deployment before claiming CI/CD is active.


The responsive release was published from commit `6cdac9fa52f952e5d96f10cd592ca807fd20515f` to both hosting targets. The team Worker version is `cd246057-e102-4c64-8c04-8c9a6ab34496`; its clean standalone bundle is 292 KiB gzipped with 25 client assets and a measured 12 ms startup. Production smoke checks passed after deployment. GitHub publication and automatic deployment remain blocked by repository integration permissions, as described above. These deployment IDs are historical checkpoints; reconcile the provider before making a future change.


## GitHub activation and browser validation

The owner supplied scoped GitHub setup access. All 13 existing commits and 169 tracked files were pushed to `Idoheled/StackSignal` main at `f672e2a9b365815baa6b66929b6d1111c8e4600a`. Actions is enabled with read-only default workflow permissions, approved GitHub-owned actions and the pinned pnpm setup action. The production environment permits main only. Main protection requires Quality and reviewed PRs for ordinary contributors; owner admin bypass remains available as requested for direct maintenance pushes. Force pushes and branch deletion are blocked. Private vulnerability reporting, dependency alerts and automatic security update PRs are enabled; secret scanning/push protection were confirmed enabled. Runtime and setup secrets were not committed.

The first hosted Quality run passed both type checks, all 22 existing tests, build and asset checks. Actual Chromium/Firefox/WebKit regressions passed 18 scenarios and found feed overflow at 768 px with the expanded sidebar. The follow-up gives the main flex child and tab root a shrinkable width, wraps filters/toolbars and hides the redundant privacy pill on compact tablets. A 1024 px viewport is also added, making 24 browser scenarios. Do not describe this follow-up as passing until the hosted runner confirms it.

Cloudflare token-policy inspection returned 403. Its permanent CI scope cannot be verified by this temporary setup token. At that checkpoint the production environment had no Cloudflare deployment secret; activation awaited the owner’s credential policy decision.


## CI credential activation — October 11

The follow-up main commit `ec1135a761b9360a59feb035d1a1b6c78b347eb9` passed hosted Quality: both type checks, all 22 existing policy/collector tests, production build, public-asset inspection and all 24 responsive browser scenarios across Chromium, Firefox and WebKit. Its tablet fix was also manually published to Worker version `2539c76c-70de-4b6d-b41a-6a4eeb6aec67`; live security smoke checks and an exact live-CSS/build match passed.

The owner explicitly retained Worker Admin, removed Turnstile management permissions and removed the token expiry. This overrides the earlier recommendation to narrow it to Worker Editor. Token-policy inspection is still denied; role/expiry details are owner-confirmed. The existing token was verified active and encrypted locally using GitHub's production-environment public key and libsodium sealed-box encryption. Only the ciphertext was sent to GitHub. `CLOUDFLARE_API_TOKEN` was created in the main-only production environment at 05:49:14 UTC. No credential was written to source, command arguments or logs.

The failed Production job in run `38115539303` was restarted using the already-verified artifact. Attempt 2 completed successfully: Quality and Production are green, Wrangler deployed the existing Worker and the live security smoke checks passed. Production job `114401003896` provides the deployment evidence. The final documentation push will independently verify the main-push trigger. This release does not mutate Supabase accounts/data, source watches, runtime keys or the collector schedule.

## Tavily web-search activation — October 11

Feature commit `e5e89e5f6b7d9ed380e2b33866c7688af0d01442` was pushed to GitHub main. Run [38119541256](https://github.com/Idoheled/StackSignal/actions/runs/38119541256) passed both type checks, all 25 tests, the standalone build/client-boundary inspection, all 24 responsive Chromium/Firefox/WebKit checks and production security smoke. Cloudflare published Worker version `2270427d-b616-46e9-a893-83832cfaa344`. The matching owner-private Sites fallback was also published.

Collector version 7 was deployed separately with its existing custom invocation authentication. The profile's web queries were changed to 20 focused public queries and its search ceiling to 800, preserving interests, priorities, repository queries and the disabled Gemini budget. No migration, account reset or reimport was needed.

The owner supplied a Tavily API key. It was installed using the existing Supabase management credential in production function secrets, without putting it in source, browser assets or command arguments. Tavily's application-integration and best-practices instructions were followed using the existing REST path; no CLI/MCP runtime was inserted into the product. Supabase acknowledged the secret update with HTTP 201.

An authorized production collector invocation returned HTTP 200 and completed eight jobs, including four genuine Tavily search jobs that stored 21 references. An unauthenticated collector invocation returned HTTP 401. Subsequent scheduled ticks completed all 20 first-day web queries, storing 86 references; search health reported `active`, configured key, no last error and last success at `2026-10-11T07:35:03.563Z`. The 61 active watches and five-minute Cron remained in place. These checks establish real provider access and persistence, not accuracy of every result or complete internet coverage.

Administrators edit queries/interests/priorities/thresholds in Coverage and inspect search status in Health. Source of truth for the live profile is PostgreSQL, not the immutable seed batch. [DISCOVERY.md](DISCOVERY.md) records query selection, filtering, exact scores, feedback behavior and current limits; [ARCHITECTURE.md](ARCHITECTURE.md#active-web-search-architecture) describes runtime boundaries. Runtime secrets remain outside Git.
