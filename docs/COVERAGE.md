# StackSignal team coverage

The starting library contains **136 distinct public references** in **29 folders**. It preserves original shared URLs and removes tracking/duplicate variants. Titles are topic labels; publication dates and authors are not invented. Chat timestamps never become publication dates.

| Area | Coverage derived from the supplied material |
|---|---|
| Serving | KServe, llm-d, Dynamo, vLLM, SGLang, LWS, lifecycle and rolling changes |
| Request routing | Envoy Gateway, Agent Router, inference extensions, KV-aware routing, Kuadrant and token quotas |
| Memory and loading | KV offload to RAM/NVMe, LMCache, KVBM, NIXL, ModelExpress and weight cache |
| Network | RoCE, InfiniBand, GPUDirect, NCCL, DeepEP, PFC/ECN, rail alignment, SR-IOV, PF/VF and macvlan |
| Resource placement | DRA, DRANET, GPU DRA driver, KAI, NRO, NFD, NUMA, NRI, PerformanceProfile and RuntimeClass |
| Hardware | Multi-vendor provisioning, BIOS/kernel/PCIe, firmware, Redfish, NetBox, Foreman and validated designs |
| Evidence | MLPerf submission code, AIPerf, perftest, nccl-tests, DCGM, RDMA exporters and cluster readiness |
| Adjacent research | Quantization/model cards, speculative decoding, agent tools, MCP, skills and security research |

The collector starts with **57 watches**: 38 release endpoints, 7 individual GitHub issues/pull requests, 4 feeds and 8 documentation pages. Source health remains “Awaiting scan” until a successful real fetch. A watch definition is not a guarantee that a repository has published releases or that an endpoint will remain available.

Core serving releases are scheduled every 2 hours; most operators every 4 hours; documentation, long-lived projects and individual issues every 12 hours. The five-minute worker tick consumes up to eight queued jobs. A conservative shared GitHub request ceiling protects unauthenticated API access. Queueing and source outages can delay delivery. This is polling, not real-time push.

## How relevance works

1. Topic matching recognizes the stack’s projects and technical terms. Short acronyms use word boundaries. Generic vendor names receive lower weight than concrete technical matches.
2. The administrator’s technical interests add local boosts; these private interest strings are not sent to an LLM.
3. Helpful/not-relevant feedback adjusts personal topic ranking within a bounded range. This does not train an external model or allow a submitted page to change system instructions.
4. Optional [Gemini evaluation](GEMINI_EVALUATION.md) samples public excerpts against recognized public stack terms and the engineering mission, validates exact evidence, and starts in comparison mode. Source material is untrusted and private collaboration data is excluded.
5. A separate installation starts AI and web-search budgets at **zero**. The existing deployment now has active Tavily search with 20 queries and an 800-request monthly ceiling; Gemini evaluation is active in Apply mode on a confirmed Free-tier project using `gemini-flash-latest`, with four attempts per rolling 24 hours and 100 monthly. Feeds, GitHub and documentation monitoring work independently.

A relevance score expresses fit, not correctness, compatibility or benchmark quality. Read the original conditions and version constraints before applying a recommendation.

See [Discovery and scoring](DISCOVERY.md) for engines, query selection, exact score arithmetic, the distinction between card score and personal ordering, feedback behavior and known gaps. The initial 57-watch import is historical; the current verified registry has 61 active watches after adding publication feeds.

## Link review

- **15 unresolved short links:** preserved exactly and available under Needs review. Their destination has not been asserted.
- **5 title-matched alternatives:** NetBox planning/branching/best-practices and Foreman KubeVirt. These retain the original Google link and do not claim a verified redirect.
- **Link checked:** means a destination was retrieved, not that its technical claims were validated.
- **Metadata pending:** keeps the original useful reference while trusted-host extraction waits for live collection.

GitHub pull requests retain their creation/update timestamps and distinguish open, closed and merged states. A merged pull request is not labelled as a released fix. PDF/video/playlist content is retained as a link; automatic full-text extraction is not enabled for those types. Unapproved external hosts are never automatically fetched.

No raw chats, personal remarks, colleague names or internal deployment details are imported. The quoted internal performance results have not been reproduced and are not used as benchmark facts.

## Repeatable import

For a separate installation, after applying the required database migrations and creating the administrator, `node scripts/import-team-library.mjs` imports the batch in one transaction. An identical retry returns the recorded result and preserves renamed/moved folders and later curation. The importer reuses URLs, records folder identities, and refuses a changed payload under an already-used batch key. Regenerate the reviewed SQL with `node scripts/import-team-library.mjs --sql` if preparing a new batch. The existing deployment has already imported this batch; discovery changes belong in the live administrator profile.
