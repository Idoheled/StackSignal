# Development

Use Node.js 24 and pnpm 11.25.0. Install from the committed frozen lockfile. Retain dependency overrides, the seven-day release-age policy and third-party notices; do not introduce another package-manager lockfile.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Existing framework development workflow |
| `pnpm typecheck` | App/framework types |
| `pnpm typecheck:collector` | Collector types with local Deno host declarations |
| `pnpm test` | Security, PGlite permissions/queues, discovery and collector tests |
| `pnpm build:standalone` | Team build without the Sites outer gate |
| `pnpm test:browser` | Three-engine regressions after standalone build |
| `node scripts/verify-client-boundary.mjs` | Inspect public assets for private seed catalog leakage |
| `pnpm deploy:cloudflare` | Guarded existing-Worker deployment |
| `pnpm smoke:production` | Live configuration, anonymous denial and security-header checks |

The collector type check is not a deployed Deno runtime test. Browser tests run the built app with intercepted synthetic API responses; they do not disable production authentication or contact Supabase. Production smoke checks make only anonymous reads and an empty cross-origin login request expected to be rejected.

## Responsive UI

Use shrinkable grid tracks and `min-width: 0` for flex children. Names, URLs, tags and notes can be unbroken: use `overflow-wrap: anywhere`. Do not conceal text overflow by clipping the entire page.

Details fill the viewport below 768 CSS pixels and use a maximum 580-pixel drawer on larger screens. The header/close control stays outside the scrolling body. Dynamic viewport height and safe-area padding account for browser chrome/cutouts. Phone inputs retain 16-pixel text to avoid iOS focus zoom. Preserve Radix focus restoration and Escape dismissal.

Browser regressions cover widths 320, 360, 390, 430, 667, 768, 1024 and 1366 in Chromium, Firefox and WebKit, including landscape. Assertions cover document/card/pane containment, scrolling to final note controls, a reachable 44-pixel close target and keyboard behavior.

Also check real iPhone/Safari and Android/Chrome: rotate with details open, focus notes with the keyboard visible, scroll to the end, enlarge browser text, close/reopen and switch themes. Check Safari/macOS and Chrome/Edge/Windows on laptops. Engine tests do not certify every physical device.

## Conventions

- UI primitives live in `components/ui/`; account flows and administration have separate components. The workspace coordinates navigation/library actions.
- Authorization belongs in the server and database, never only in button visibility.
- Collection/extraction/ranking use shared modules, canonical URLs and explicit provenance.
- Add focused regressions for permission, date, queue and responsive-interaction bugs. Avoid tests that merely repeat implementation details.
- Add migrations rather than editing applied ones. Preserve existing accounts, imports and preferences.
- Keep secrets, private exports, raw chats and provider tokens out of source/tests/logs. `.env.example` contains placeholders only.

The managed authoring workspace may prohibit local browser automation. There, run static/build checks and use GitHub-hosted browser CI; do not install a local browser as a workaround. Claim browser validation only after the runner actually passes.
