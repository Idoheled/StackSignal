# Web discovery

[Documentation hub](README.md) · [Discovery and scoring](DISCOVERY.md) · [Architecture](ARCHITECTURE.md) · [Coverage](COVERAGE.md)

Tavily adds genuine internet search alongside the existing feeds, documentation watches and GitHub release/project APIs. Search uses only administrator-authored public technical queries. Private notes, chats, usernames and internal deployment identifiers are not used to generate provider requests.

## Deployed status

Tavily was activated on October 11, 2026. The key is installed in Supabase production function secrets; it is not committed or sent to the browser. Collector version 7 completed all 20 queries in its first daily sweep and stored 86 references. Health reported active with no search error at the verification checkpoint. The monthly ceiling is 800 and the hard daily ceiling is 24. Gemini remains disabled. See [operations history](OPERATIONS.md#tavily-web-search-activation--october-11) for the dated evidence; Health is the live status source.

## Activation for a separate installation

1. Create a Tavily free account at https://app.tavily.com and a dedicated API key. Keep paid plans/pay-as-you-go disabled. Never commit or paste the key into issues.
2. Install `TAVILY_API_KEY` in the existing Supabase collector's function secrets. This is a collector secret; it does not belong in the browser, Cloudflare website or GitHub deployment workflow.
3. In Administration → Coverage, review the web queries and set a monthly ceiling from 1 to 800. A zero ceiling pauses web discovery. Existing source/GitHub monitoring continues independently.
4. Let the five-minute collector run. Administration → Health reports key readiness, state, last success/error and the last query's accepted/duplicate/filtered results.
5. Verify a genuine successful search and a persisted result before describing discovery as active. Synthetic tests and a deployed function alone do not establish provider access.

Tavily documents 1,000 free credits per month and one credit per basic search. This app fixes `search_depth=basic`, disables automatic parameter selection/answer generation/raw extraction, and caps requests at **24 per UTC day** and the administrator's ceiling of **at most 800 per UTC month**. Reservations include unsuccessful attempts conservatively. Limits apply to this app, not other consumers of the same provider account; account billing still needs to remain free.

References: [credits and pricing](https://docs.tavily.com/documentation/api-credits), [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search).

## Coverage and scheduling

The prepared profile has 20 focused queries spanning serving, memory/cache, networking, hardware, OpenShift/operators, resource placement, routing/token policy, benchmarks, observability, provisioning and emerging research. Defaults live in [source-config.ts](../lib/source-config.ts); administrators edit the live profile without a code deployment.

Queries are scheduled daily and deduplicated through the queue. On each day, a rotating three quarters use a recent-week window; one quarter searches without a date window to discover useful older work. Each query rotates into exploration over four days. Every response is bounded to eight results. Unknown publication dates stay unknown; exploration results appear in New to radar based on first discovery.

Queue capacity, retries, provider throttling and quotas affect delivery. A five-minute tick is not a five-minute web freshness guarantee. Quota errors defer work; they do not consume a normal failure attempt. Paused search makes no provider calls, and jobs for removed queries are skipped.

## Selection and provenance

1. Validate result structure, canonical HTTPS identity, size bounds and usable public text.
2. Reject private/credentialed URLs, portfolio/hiring/finance/promotional noise and snippets with insufficient technical relevance.
3. Deduplicate canonical URLs, including tracking variants, against stored articles.
4. Apply the existing technical profile/relevance rules; never interpret the provider's query score as factual quality.
5. Preserve snippet, query, search window, publisher hostname and search-reported publication date when valid.
6. Queue direct metadata extraction only for approved hosts; arbitrary result domains never expand the allowlist. PDFs remain references without automatic full-text extraction.

Search-only results are labeled **Web search result**, with no invented availability-check timestamp. A later successful approved-host fetch can establish **Link checked**. Publication dates reported by search are labeled in the detail pane; a publisher extraction can replace that provenance when it supplies a date.

`known_publisher` means the host is already in the controlled technical-publisher list; it does not certify the article's claims. `open_web` retains useful new sources while making their provenance clear. Search snippets are treated as untrusted text and are never executed.

## Quality limits

The filters reduce obvious noise but remain heuristic. This change adds broad search coverage; it does not turn the relevance score into a probability or validate benchmarks. The [conservative Gemini evaluator](GEMINI_EVALUATION.md) is a separate optional sweep with its own server key, Flash Latest alias, atomic attempt limits, cache and evidence checks. It is not silently enabled by web search.

No implementation can promise every useful item on the internet. Review original conditions, versions and results before adopting a recommendation. Use feedback and refined queries to improve coverage over time.
