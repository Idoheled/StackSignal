# Contributing

Start with [developer onboarding](docs/ONBOARDING.md#developers), the [architecture](docs/ARCHITECTURE.md) and [design decisions](docs/DESIGN.md). The [documentation hub](docs/README.md) maps the product and operating guides.

Preserve accounts, saved content, source preferences and privacy boundaries. Branch from current `dev` using `feat/<topic>`, `fix/<topic>` or `docs/<topic>`. Feature PRs target `dev`; tested release PRs promote `dev` to `main` after owner approval. See [branching and maintenance](docs/BRANCHING.md). Describe the trigger, user impact and resulting behavior; keep unrelated changes separate.

Add changes under the changelog’s `[Unreleased]` section. For a named release, follow [repository releases](docs/RELEASES.md); use `pnpm release:prepare <version>` to keep package metadata and release notes together.

Run app/collector type checks and `pnpm test`. For UI changes, build standalone and run responsive browser checks on a supported machine or GitHub runner. Update relevant documentation/changelog, then open a PR with evidence. CI must pass before merging. Include migration/rollback steps for data changes and phone/browser/viewport details for layout changes.

Use TypeScript, two-space indentation, semantic controls and accessible focus behavior. Follow established component/domain boundaries and use Mermaid diagrams. Add migrations rather than editing applied ones. Retain the frozen lockfile, release-age policy and third-party notices.

Use synthetic fixtures. Never submit credentials, TOTP material, private chats, organization addresses or production exports. Report vulnerabilities privately under [SECURITY.md](SECURITY.md). Record unresolved advisories in `docs/SECURITY.md`; do not hide failures with blanket exclusions.

For documentation changes, verify relative links/anchors and command names, keep Mermaid diagrams readable, and distinguish implemented behavior from optional integrations or unverified claims. Update the README for product-level changes, the appropriate guide for details, and `docs/DESIGN.md` when a boundary/tradeoff changes. Keep dated execution evidence in `docs/OPERATIONS.md`; do not turn historical setup steps into required actions for existing production.
