# StackSignal operations checkpoint — October 11, 2026

## WhatsApp pairing and announcement — October 18, 2026

Phone-code linking succeeded. At 07:26 UTC the verified StackSignal group
received a guarded announcement through the actual OpenClaw transport with a
confirmed provider ID. The private manifest records pairing/destination/receipt
proof. Temporary maintenance ingress and the Actions request secret are removed.
No further owner pairing steps are required. Automatic content dispatch remains
paused pending article/release pipeline tests and rollout. Main is unchanged.

## WhatsApp host preparation — October 14, 2026

Latest checkpoint (October 17, 20:50 UTC): the allocated Jerusalem ARM host,
2 OCPU / 12 GB with a 50 GB boot volume, is `AWAITING_WHATSAPP_QR`.
All four services passed active checks, local Qwen3 generated a real alert in
70.7 seconds, and public HTTPS health returned 200 with delivery disabled.
The provisioning cron stopped and removed its own schedule automatically;
existing collector/evaluator/internal-review schedules remain active. Owner
handoff instructions are on PR #4. Phone pairing, exact group verification and
real delivery receipts remain release gates. See
[WhatsApp progress](WHATSAPP_PROGRESS.md) for dated evidence and the historical
preparation snapshots below.

Post-bootstrap cleanup: the resource-claim schedule is absent and its control
flag is false. The private dispatch helper returns null without queuing HTTP.
Normal CI no longer contains an OCI job/input, and the workflow template is
archived outside GitHub's active workflow directory. The
[dormant toolkit](../ops/oci/README.md) preserves the complete provisioning flow,
safety boundaries, lessons and explicit recovery procedure. Existing VM/private
configuration and owner SSH recovery are preserved for the next QR session.

Historical October 14 preparation: work is isolated on `feat/whatsapp-notifications`, based on release
`v0.1.1`. The owner has an OCI account and a WhatsApp group, and selected local
Ollama to preserve Gemini evaluation quotas. Draft PR #4 contains opt-in UI,
an additive private outbox, signed webhook dispatch/receipts, a durable SQLite
receiver and Ollama/OpenClaw adapters. No Oracle VM, production schema, message
or main deployment was created. All 86 automated tests, ten OCI checks and both
TypeScript checks passed locally. Direct OCI authentication works; home-region
ARM capacity is unavailable. Hosted browser checks and actual host installation,
pairing and delivery remain release gates. Follow [WhatsApp progress](WHATSAPP_PROGRESS.md) and
[host onboarding](WHATSAPP_SETUP.md); do not treat this as an enabled feature.

## Preserve this deployment

- Team website: https://stacksignal.stacksignal-idoheled.workers.dev — deployed on the owner's existing Cloudflare account `49c94d7ba2a9124b3e0ddea7a329ad05`, Worker `stacksignal`.
- Website: https://stacksignal.idoheled456.chatgpt.site
- Sites project: `appgprj_6ab7758753248191afc68fe0a1584d9d`. The hosting audience is still custom, owner-only. Do not broaden it or create another project when resuming.
- Supabase Free project: `plbjscbpvfozqvexmqhk`, Frankfurt, existing organization `cvgjoziulovsxkrotbhr`.
- Runtime environment revision 3 holds the app origin, encrypted-session key, Supabase keys and Turnstile keys. The private-preview flag is absent. Never print or regenerate runtime secrets during continuation.
- Existing owner `administrator` is active, has changed the temporary password, and completed a fresh TOTP enrollment at 10:44–10:45 UTC on October 10. The obsolete temporary administrator credential file was removed. Do not bootstrap/reset this account.
- The original import contains 136 links, 136 bookmarks, 29 folders and 57 watches. It is immutable and already applied. Collection has since expanded the article count. Do not re-run the import with a changed batch payload.

## Latest release display — October 11, 21:06 UTC

The `latest_project_releases` migration is applied. Discovery and hidden views now select one latest approved, channel-eligible release per project before search, personal read/dismiss state, sorting or pagination. Weekly and unread-release counts share the selection. Numeric version components and preview sequence numbers take priority for comparable tags; other schemes use publisher dates. Canonical GitHub release URLs avoid legacy source-label/casing splits, and official OpenShift streams share one project with preview opt-in respected in every discovery mode. Saved versions remain in the shared library; historical rows and immutable assessments are retained.

The production check selected **26 current release projects from 126 approved historical releases**, suppressing 100 older release cards. KAI Scheduler resolves to `v0.18.5`, published at `2026-10-11T14:55:01Z`; its scheduled collection had already filled the missing date before this migration verification, so no duplicate manual repair was applied. All **717 assistant reviews**, their checksum, **166 bookmarks, 29 folders and 14 feedback rows** were unchanged. Coverage still counts approved historical assessments; discovery totals exclude superseded releases and can be lower. Existing new-link Gemini selection and quota ledgers were not changed.

All **40 automated tests passed locally**, including three new database regression groups for global selection, saved history, member isolation, preview channels and deterministic date ties. Security advisors reported the same existing findings as before the change; private helper execution remains denied to client roles. The matching main workflow must confirm hosted browser/build/deployment checks after publication. Do not reapply this migration or repeat the 717-link review during continuation.

The latest-release implementation is committed as `2e2250aa8924da660d205093997b8af54312e71c`. Repository access was restored on October 11 at 21:22 UTC, and the implementation and documentation were pushed normally to GitHub main through `b2464c1b66bd185b2c9705e37e6f6e9756de2fb6`. The earlier credential/integration failures are resolved for this authorized publication. The matching main workflow runs the full Quality gate before automatic Cloudflare deployment; consult the latest main workflow for final hosted results. Do not reset or repeat the live migration, imports or historical review when publishing source.

The database policy is active on both existing hosting targets. The existing owner-private project also preserves the source through `b2464c1b66bd185b2c9705e37e6f6e9756de2fb6`, deployed at 21:15 UTC as `appgdep_6acbfc45fe108191bbb1f4348efa73ef`. Its owner-only audience and runtime environment revision 3 are unchanged. Post-deployment verification preserved the 717 assessments and their checksum, 166 bookmarks, 29 folders and 14 feedback rows; team-site security smoke also passed.

The earlier durable-review feature and documentation were pushed through `c0a45894ea1344348e2ad33b91cc8f3beeb002a1`. [Run 38164530598](https://github.com/Idoheled/StackSignal/actions/runs/38164530598) passed 37 tests, both type checks, all 24 Chromium/Firefox/WebKit checks and production security smoke. Worker version `bb3e989f-80c2-44a8-8f23-09daa2d0a32a` was deployed at 18:39 UTC, and post-deployment checks preserved the review checksum. This supersedes the earlier preparation-only frontend status below.

## Review handoff — October 11, 18:06 UTC

Collector **version 18 is ACTIVE**. The `durable_review_handoff`, `assistant_review_display_score` and `review_import_validation` migrations are applied. The frozen collection includes 717 existing URLs, including 28 URLs already queued when the review began. All 717 assistant decisions are stored: **336 approved, 272 not selected, 109 insufficient evidence, zero awaiting assistant review**. No old collection job, website redeployment or metadata refresh may reset these decisions. Reviewer, review date, evidence and reviewed-content snapshots are durable in PostgreSQL; immutable private history and 90-day retention exclusions back them. Do not rerun historical imports or the bulk review. Use the service-only coverage RPC for current counts.

Apply (`rerank`) is restored for **new URLs only**. Both candidate selection and atomic reservation exclude the frozen cohort. Provider limits remain 16 requests per rolling 24 hours/Pacific day and 496 per UTC month, with five-minute spacing and five links per request. The existing 16 requests were preserved; the earliest next opportunity at this checkpoint is October 12, 10:48:30 UTC / 13:48 Israel time. The upper bound is 80 assessments per day, with actual throughput dependent on available inputs and successful batches.

The broken llm-d Agentgateway documentation watch now uses `/docs/dev/infrastructure/gateway/agentgateway`, preserving its watch ID. Seven remaining source flags at this checkpoint are GitHub quota deferrals, with zero active source-error flags. The UI separates current healthy scans, quota deferrals, genuine errors and delayed scans. GitHub enrichment is capped separately at 15/hour without a token under the unchanged 45/hour global ceiling, reserving capacity for source watches. Only two repository-health probes are queued per tick; missing-title Markdown extraction is handled safely. The five-minute Cron remains active.

All 166 bookmarks, 29 folders and 14 feedback rows remain. Existing rejected references remain accessible through their saved library entries. Use Discover → All reviewed or New to radar to consume newly approved historical material; publisher-date and prerelease filters can narrow other views. Relevance review does not certify third-party code or reproduce GPU benchmarks.

Before frontend publication, both TypeScript checks, all 37 updated automated tests, standalone build and client-boundary inspection passed. Hosted browser/deployment checks must be verified for the final commit. Do not claim hosted publication from this preparation checkpoint alone.

The owner-private Sites fallback was published at 18:21 UTC from feature commit `b41c070b92c60530b7eed15c0abf414e1d57388c` (deployment `appgdep_6acbd393c9a881919942f0d53a3aeb6a`). Post-deployment checks confirmed all 717 assistant decisions and their checksum were unchanged, alongside the 166 bookmarks, 29 folders and 14 feedback rows. Live team-site security checks also passed. GitHub's integration still rejected source writes at this checkpoint; the owner subsequently supplied repository access and authorized committing/pushing these changes. Publish with a normal fast-forward push, then confirm the matching main workflow's Quality and Production jobs before recording the team frontend as deployed. Do not repeat the migrations, collector deployment, imports or bulk evaluation during this publication step.

## Historical discovery checkpoint — October 11, 16:08 UTC

Collector **version 17 is ACTIVE**. The `repository_health_release_probes` and `discovery_probe_identity` migrations are applied. GitHub suggested links now require fresh repository health as well as useful AI review. Defaults: 100 stars, five actual watchers, two published releases in the past year, a push within 90 days and a release within 180 days. Public/non-fork/active/licensed checks are mandatory. Administrators can edit thresholds and pause Trending in Coverage; existing saved references remain accessible.

The second additive import is already applied under `team-knowledge-expansion-2026-10-11-v1`: **28 references, 29 bookmarks and 27 watches added**, reusing existing folders/duplicates. There are **88 active watches** at this checkpoint. Do not reapply or alter either historical batch. Expanded public interests/queries include kagent, Agentgateway, gateway authorization, KV-cache storage and collective/expert communication; existing topic priorities and provider limits are preserved.

Daily Trending completed at 13:27:39 UTC and weekly Trending at 16:07:46 UTC. Their queue identities now include lane and period, preventing one from suppressing the other. Four official amd64 OpenShift watches have each collected five Accepted tags. The final 4-dev-preview poll succeeded at 16:08:01 UTC after accommodating its 2.73 MB detail response. Ordinary page bodies stay limited to 2 MB; official per-tag OpenShift responses allow at most 8 MB with changelog input capped at 6 MB. RC/engineering previews are labeled and do not assert support or safe upgrade paths.

An authenticated version-17 collector check returned HTTP 200, processed seven jobs; a request without its secret returned 401. Candidate/queue RPC execution remains denied to authenticated application roles. All **36 policy, security, database and collector tests** and both TypeScript checks passed. Frontend publication and GitHub CI use the matching source commit; consult the latest main workflow rather than a historical run ID. See [repository discovery policy](REPOSITORY_DISCOVERY.md) and [deployment](DEPLOYMENT.md).

AI mode remains Apply (`rerank`), **16 requests per rolling 24 hours and Pacific day / 496 per UTC month**, five-minute global spacing, up to five assessments per request. At this checkpoint all 16 requests have been used, including failed attempts; collection continues while review waits for capacity. Last successful batch was 15:20:31 UTC with four valid reviews; invalid evidence stayed withheld. Seven retained suggestions currently pass both review and maintenance gates. These counts are snapshots, not guarantees. Quotas were not reset or raised to verify the new probes.

## Evaluation rollout checkpoint — historical October 11

The owner authorized batch review and reviewed-only suggestions after supplying AI Studio quotas of **5 RPM, 250,000 input TPM and 20 RPD** on a Free-tier project. The `batch_reviewed_discovery` migration adds separate request/claim ledgers, preserves historical usage, retires the old single-link reservation and enforces reviewed-only admission on all feed modes, including release alerts. Saved library content and accounts are preserved.

Collector **version 15 was active at this rollout checkpoint** and evaluates up to five independently validated links per synchronous Flash Latest request. Live target configuration: **Apply (`rerank`), 16 requests per rolling 24 hours and Pacific day, 496 per UTC month**, with five-minute global spacing. No full-month spreading is needed at this daily ceiling; requests run on demand until the shared budget is reached. Existing preferences persist; only these explicitly authorized budget fields are raised. Independent installations remain disabled until activation.

Inputs lacking public text receive bounded approved-host extraction; GitHub repositories can use public README text. Insufficient snippets can receive one richer fetch. Failed inputs receive bounded delayed retries, while pending/uncertain/error results stay out of suggestions. At most 80 link assessments/day is a capacity ceiling, not an exhaustive-coverage guarantee. Live verification at 12:00 UTC confirmed the historical request was preserved, the first batch reserved exactly one additional request for five inputs, and collection returned HTTP 200. Google returned HTTP 503; all five links stayed withheld and the failed request counted. Version 15 distinguishes transient 5xx failures (15-minute global backoff) from quota/auth errors (24 hours). The next provider opportunity is after 12:15 UTC, subject to the scheduled tick and quotas. The profile is verified as Apply / 16 / 496. Client roles cannot execute the batch reservation; the service role can, and both new ledgers have RLS. Health is authoritative for changing counts.

The previous version 13 used one request per link with four daily/100 monthly attempts. Its first assessment on October 11 at 10:48 UTC resolved to `gemini-3.8-flash` and judged a generic LLM security introduction tangential. That historical request is retained in the new request ledger. See [the full evaluation policy](GEMINI_EVALUATION.md).

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

- Discover → This week / Releases / New to radar / Updated docs / All reviewed.
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

## 2026-10-18 — WhatsApp registration staging

- Applied additive registration-state migration after the full migration-chain
  tests passed. The old opt-in API remains compatible.
- Marked only the owner, Eilon and Roi as administrator-confirmed registered
  members at the owner's request, using exact identity guards and an audited
  transaction. Other members remain unregistered.
- Added signup-to-login group handoff, explicit self-confirmation, a settings
  switch and an exit-group reminder. No automatic WhatsApp join/removal claim.
- Production UI/main remain unchanged while the private version is reviewed.
  The notification dispatcher cron remains paused; resource polling remains
  retired. See the checkpoint for later delivery verification results.

Live registration migration history version: `20261018074942` (management-tool
application); its CLI-created source file was reconciled to that returned
version. Earlier hosted/local timestamp differences predate this change and
must not cause migrations to be replayed. The named registration update and
schema were verified by live reads and the advisor; production dependencies
have no reported advisories. The full development-tool audit retains the three
previously documented advisory paths; no blanket suppression was added.

At 08:00:12 and 08:01:37 UTC, explicitly labeled real release/article tests
completed through the deployed dispatcher, signed HTTPS receiver, SQLite queue,
local Ollama and OpenClaw. Both outbox records are Sent, have provider receipts,
zero webhook failures and cleared payloads. Signed replay returned the same
receipts; unsigned requests returned 401. The tests used two already-reviewed
public articles with valid platform deep links, without altering their content
or review history. Cron stayed paused; a temporary future admission watermark
blocked ordinary new admissions during the manual test. Global enablement was
then restored to false and the watermark to its prior null value. Receipt IDs
remain in the protected database and host ledger.

## 2026-10-18 — Columbus rollout and scheduled-review repair

Owner approval of the private registration UI authorizes promotion through dev
to main. The additive first-review/new-discovery admission migration is applied
as `20261018084521`; activation still uses a fresh timestamp rather than a backlog
replay. The guarded activation transaction additionally requires recorded live
Columbus verification. Resource claiming stays disabled and has no cron job.

Scheduled discovery remained active (37 discoveries over the audited 24-hour
window). Internal-review HTTP calls were failing despite successful cron SQL
submission. A contiguous-evidence slice split a Unicode surrogate pair, causing
PostgreSQL JSONB to reject the whole review batch. Unicode-safe slicing restored
success and processed 563 pending inputs, with 154 useful approvals. Historical
items were not broadcast because notification admission stayed paused.

Columbus uses the existing paired socket and local qwen3:4b, with a hash-pinned
pre-decryption group filter, fixed outbound destinations, no generic agents or
tools, and durable question IDs. Initial live installs rolled back on reconnect
failure. Encrypted startup reports exposed service-file ownership and plugin
source-capture constraints, which the reproducible installer now preserves.
Final rollout evidence belongs in the current WhatsApp checkpoint; a successful
maintenance workflow alone is not evidence of a successful runtime update.
