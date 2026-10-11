# StackSignal operations checkpoint — October 11, 2026

## Preserve this deployment

- Website: https://stacksignal.idoheled456.chatgpt.site
- Sites project: `appgprj_6ab7758753248191afc68fe0a1584d9d`. The hosting audience is still custom, owner-only. Do not broaden it or create another project when resuming.
- Supabase Free project: `plbjscbpvfozqvexmqhk`, Frankfurt, existing organization `cvgjoziulovsxkrotbhr`.
- Runtime environment revision 3 holds the app origin, encrypted-session key, Supabase keys and Turnstile keys. The private-preview flag is absent. Never print or regenerate runtime secrets during continuation.
- Existing owner `administrator` is active, has changed the temporary password, and completed a fresh TOTP enrollment at 10:44–10:45 UTC on October 10. The obsolete temporary administrator credential file was removed. Do not bootstrap/reset this account.
- The original import contains 136 links, 136 bookmarks, 29 folders and 57 watches. It is immutable and already applied. Collection has since expanded the article count. Do not re-run the import with a changed batch payload.

## Security review and discovery release

The `security_review` migration is already applied. It requires an existing, unexpired provider Auth session in addition to the app session, checks a currently verified TOTP factor for writers, and repairs expired-trash cleanup of bookmarks.

The `discovery_radar` migration is now applied. It adds release-channel and watch-priority controls, source revisions, confirmation-protected watch deletion, profile merging/validation, fair job claims, duplicate-safe job enqueueing, service-only aggregate tag feedback and release/radar feed modes. It preserves existing accounts, folders, saved links, notes and read states. It also adds four validated publication feeds (arXiv distributed systems/machine learning, PyTorch, NetBox), bringing the registry to 61 sources.

Collector version 6 is active, with custom 256-bit invocation authentication (`verify_jwt=false` is intentional; the handler requires the collector secret). Its bundle includes the new relevance and source configuration modules. Stable releases are the default; public project discovery runs daily without an API key, with eight initial editable queries. Optional Gemini and Tavily calls remain disabled (ceilings zero, no API keys assumed). Source checks run on the existing `stacksignal-collector` Cron job every five minutes using Vault credentials. Publisher quotas defer work without consuming retry attempts.

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

1. Team access still needs a hosting audience decision or standalone deployment. Application invitation links alone do not bypass the owner-only hosting gate. Do not silently publish the library or add external visitors.
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

For team access, prepare the same app on the owner's existing Cloudflare account, retaining StackSignal username/password login and MFA. Keep this Sites project owner-only. The provided Cloudflare token verifies as active and lists Workers, but the Workers subdomain API returns HTTP 403. Token-policy details also return 403. No standalone Worker has been created. The owner must grant account-level Workers deployment permissions before proceeding; no Cloudflare browser login retry is needed. Cloudflare's current role model requires Workers Admin at the Workers product scope to create a new Worker. Ask the owner to edit the existing token with that temporary role, restricted to the existing account, retaining its Turnstile permission. After setup, revoke the temporary token or narrow it to Editor on StackSignal. See https://developers.cloudflare.com/workers/authorization/workers/ .

After permission is available: reconcile existing account subdomain and Worker state, deploy only on the Free plan, set APP_ORIGIN to the exact worker origin, authorize that hostname on the existing Turnstile widget, retain the owner Site hostname while it is still in use, and configure the corresponding Supabase Auth origin/redirect allowlist. Upload runtime secrets through stdin. Never bootstrap the administrator or repeat the original import. Verify anonymous denial and have the owner log in with the existing password/authenticator before team onboarding. The deployment helpers and source are already versioned; runtime secrets remain outside Git.

The standalone build and Wrangler deployment dry run passed on October 11. These validate packaging only; no standalone Worker is deployed and its remote login remains unverified. The preserved private Sites version remains the available website.
