# Contributing

Preserve accounts, saved content, source preferences and privacy boundaries. Branch from current `main` with a descriptive name. Describe the trigger, user impact and resulting behavior; keep unrelated changes separate.

Run app/collector type checks and `pnpm test`. For UI changes, build standalone and run responsive browser checks on a supported machine or GitHub runner. Update relevant documentation/changelog, then open a PR with evidence. CI must pass before merging. Include migration/rollback steps for data changes and phone/browser/viewport details for layout changes.

Use TypeScript, two-space indentation, semantic controls and accessible focus behavior. Follow established component/domain boundaries and use Mermaid diagrams. Add migrations rather than editing applied ones. Retain the frozen lockfile, release-age policy and third-party notices.

Use synthetic fixtures. Never submit credentials, TOTP material, private chats, organization addresses or production exports. Report vulnerabilities privately under [SECURITY.md](SECURITY.md). Record unresolved advisories in `docs/SECURITY.md`; do not hide failures with blanket exclusions.
