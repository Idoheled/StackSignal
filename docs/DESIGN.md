# Design principles and decisions

[Documentation hub](README.md) · [Architecture](ARCHITECTURE.md) · [Contributing](../CONTRIBUTING.md)

This document explains the implemented design and the constraints future changes should preserve. It is a decision record, not a list of promised features.

## Product north star

**Help an AI infrastructure team notice valuable developments across its entire stack and retain the knowledge needed to use them well.**

The operating idea is “I don't know what I don't know.” Known dependencies need reliable monitoring, while exploration must reach beyond the existing watchlist. Both need enough provenance for an engineer to decide what to trust and what to test.

| Principle | Design consequence |
| --- | --- |
| Breadth with technical context | Cover hardware through serving/traffic policy; use concrete technical terms rather than vendor news alone |
| Explainable suggestions | Keep source links, reasons, excerpts and date provenance alongside ranking |
| Human control | Separate discovery from adoption; make feedback and administrator tuning explicit |
| Durable team knowledge | Use shared folders/discussion plus author-private notes; preserve data across frontend releases |
| Private membership | Invite-only accounts, writer MFA, server/database permission checks |
| Bounded cost and work | Poll through queues, cap provider usage, and keep optional paid services off by default |
| Phone-first use | Fit long technical names, keep details/close controls reachable, and support keyboard/text scaling |

## 1. Separate reading from collection

**Decision:** The Cloudflare website reads durable results. A scheduled Supabase function performs collection independently.

**Reason:** A user opening the feed should not trigger a fan-out of external requests or wait for slow publishers. Collection must continue when everyone closes the site.

**Tradeoff:** Delivery is eventually consistent. A five-minute tick is not a five-minute freshness promise for every source; watch intervals, queue load and throttling also matter.

**Preserve:** Fetching in the collector, bounded leases/retries, visible source health and an accurate distinction between scan-now and synchronous collection.

## 2. Use polling with explicit watches and broader discovery

**Decision:** Combine release APIs, feeds, documentation watches, public repository queries and team submissions.

**Reason:** Explicit watches follow dependencies precisely; feeds and queries help discover work the team has not already selected. Public polling also works across publishers with different integration capabilities.

**Tradeoff:** Query/host/source coverage is finite. Most publications do not offer a common webhook interface, and source endpoints can disappear or change format.

**Preserve:** Editable watches, stable-release defaults, prerelease opt-in, canonical URLs and administrator control over discovery. Treat external source health as an observable dependency.

## 3. Start with deterministic relevance

**Decision:** Technical-term scoring, priorities/interests, release signals and bounded feedback form the baseline. Optional model analysis is separate.

**Reason:** The baseline is explainable, works without paid APIs and remains available when an external AI provider is absent or fails.

**Tradeoff:** Rule-based matching can miss context or elevate a superficially matching page. A model can also be wrong. Neither is a technical validation engine.

**Preserve:** Reasons/evidence, human original-source review, bounded feedback, zero default provider budgets and deterministic fallback. New provider integrations must not expose private notes/chats or let source text invoke tools.

## 4. Keep time and provenance separate

**Decision:** Store publication, discovery and update/change times with provenance. Preserve unknown metadata instead of inferring it from chat/import times.

**Reason:** “New to us” and “newly published” answer different questions. A documentation edit, PR merge and stable release are different events.

**Tradeoff:** Unknown-date material cannot honestly appear as a new publication. Users need separate radar/history views to find it.

**Preserve:** Weekly publication semantics, first-discovery views, original/canonical references, review labels and truthful release/PR status. Do not make date fields interchangeable to fill an empty feed.

## 5. Put identity and permissions behind the UI

**Decision:** The browser calls a same-origin Worker gateway; Supabase manages identity/password hashes; the database independently enforces current membership, bound sessions, MFA and action permissions.

**Reason:** Hiding an admin button cannot protect an API. Revocation and private-note isolation need checks where the data is read or changed.

**Tradeoff:** Live identity/database checks add requests and external dependencies. Privileged provider operators remain outside the application role model.

**Preserve:** Username login, invitation-only signup, writer MFA, encrypted HttpOnly sessions, same-origin mutation checks, database authorization and protected owner semantics. Private notes are access-controlled, not an end-to-end encryption promise.

## 6. Share the library and make note visibility explicit

**Decision:** Folder structure/bookmarks are shared; feedback/read state is personal; notes are team-visible or author-private.

**Reason:** The team needs a common knowledge map without exposing every unfinished personal thought. Personal dismissals should not delete the shared source.

**Tradeoff:** Readers cannot curate; shared folder changes affect everyone; private note visibility does not imply a private folder.

**Preserve:** Explicit visibility, author-only edits, confirmed destructive actions, recoverable folder/note trash and recursive saved-title search. Visibility changes should never silently publish an existing private note.

## 7. Treat collection as a security boundary

**Decision:** Automatically fetch only controlled, trusted public HTTPS hosts; validate redirects/DNS and enforce size/time/request limits. Render extracted content as text.

**Reason:** Submitted or scraped URLs can target internal services or carry hostile content. A useful link must not become arbitrary network or code execution.

**Tradeoff:** An interesting new domain may need operator review. DNS validation is not response pinning; allowlisting remains the primary trust boundary.

**Preserve:** No automatic host-allowlist expansion from a pasted link, no scraped HTML execution, no model tools/workspace access, and explicit evidence validation for optional AI output.

## 8. Deploy a verified artifact and release data separately

**Decision:** GitHub checks a commit, builds once, and deploys that run's verified artifact to the existing Worker. Database migrations and collector releases are separate.

**Reason:** Deployment should use the tested output, preserve runtime secrets and avoid resetting knowledge as a side effect of a frontend release.

**Tradeoff:** Changes spanning UI/RPC/collector need coordinated, compatible rollouts. A failed post-deploy smoke test requires investigation; it does not automatically undo a deployment.

**Preserve:** Pinned actions/frozen lockfile, PR credential isolation, source/artifact checks, serialized deployment, additive migrations, independent recovery procedures and live negative security tests.

## 9. Design for technical reading on phones

**Decision:** Cards wrap long titles/tags; phone details fill the viewport with a separately scrolling body and persistent close control; larger screens use a bounded drawer.

**Reason:** Repository names, URLs, version strings and notes are often unbroken. Browser chrome, cutouts and virtual keyboards affect reading space.

**Tradeoff:** More density is possible on laptops, but adding controls must not introduce horizontal overflow or hide phone actions.

**Preserve:** Shrinkable layouts, safe-area/dynamic-height handling, 16-pixel phone inputs, accessible focus/Escape behavior and meaningful tests across three engines/eight viewports. Use real-device checks for behaviors the synthetic suite does not verify.

## Review a proposed change against these questions

1. Does it help an engineer discover, understand or retrieve useful knowledge?
2. Are evidence, date semantics and unresolved metadata still honest?
3. Does it preserve membership, MFA, note visibility and safe-fetch boundaries?
4. Are cost/work limits explicit and failures observable?
5. Will it preserve existing data, remain usable on a phone, and have a clear release/recovery path?

Add a new decision here when a change alters a boundary or tradeoff. Keep implementation commands in [development](DEVELOPMENT.md), provider procedures in [deployment](DEPLOYMENT.md), and dated execution evidence in [operations](OPERATIONS.md).
