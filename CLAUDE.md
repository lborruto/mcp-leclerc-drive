# mcp-leclerc-drive — notes for Claude

Standalone, hardened continuation of [skunkobi/mcp-leclerc-drive](https://github.com/skunkobi/mcp-leclerc-drive)
(v0.3.0, commit `ac341d7`, MIT, unmaintained since July 2026). The upstream history is kept;
remote `upstream` = skunkobi (push disabled), `origin` = `lborruto/mcp-leclerc-drive` (public).

Unofficial MCP server for E.Leclerc Drive. It drives a real Chrome over CDP with a dedicated
profile and runs every request as a `fetch` **inside the page**, so DataDome sees a real browser.
Scope: search products and fill the cart from an MCP client. Nothing past the cart.

## Permanent rules

- NEVER add a tool that validates the cart, picks a slot, places an order or pays.
- NEVER read, store or log a password, cookie or 2FA code.
- No network call outside the allowlist: `^fd\d+-(courses|secure)\.leclercdrive\.fr$`,
  `www.leclercdrive.fr`, `api-recherchemagasins.leclercdrive.fr`, plus `127.0.0.1` (local CDP).
  No telemetry.
- No new npm dependency without asking the owner and justifying it. Today: `@modelcontextprotocol/sdk`,
  `zod` (dev: `typescript`, `@types/node`).
- No npm publication (`"private": true`): install from this repository only.
- One task = one clear commit. `npm run typecheck`, `npm run build` and `npm test` before each commit.
- Before any live test against Leclerc Drive, ask the owner to confirm they are logged in in the
  server's Chrome window. Few requests, no bulk loops, keep the throttling.
- Commit as `luca.borruto@gmail.com` (set in the local git config), never the work address.
- Never push `main` without the owner's go-ahead.

## Layout (src/)

| File | Role |
| --- | --- |
| `index.ts` | stdio MCP server: tool declarations (zod, annotations), server instructions, shutdown. stdout is the MCP channel: logs go to stderr only. |
| `format.ts` | French text rendering of tool results. |
| `browser.ts` | `ChromeSession`: launches/reuses Chrome, own tab, native-WebSocket CDP with timeouts, `fetch()` run in the page (origin + redirect checks inside). |
| `chrome-profile.ts` | Main-profile guard; lock (PID, port, DevTools browser id) so the server never attaches to a Chrome it did not start. |
| `hosts.ts` | Host allowlist, store host/id rules. |
| `errors.ts` | `BlockingError`: failures every following request would hit. `SiteChangedError`: the page is no longer in the shape we read. |
| `usuals.ts` | Usual products (name → product id, per store), persisted to `~/.mcp-leclerc-drive/habituels.json`. |
| `leclerc/http.ts` | The one request path: shared throttle, 403/429 backoff, one re-navigation on "Failed to fetch" / stale tab. |
| `leclerc/client.ts` | Search, cart read, cart changes (exclusive, one store snapshot per operation), `add_many`. |
| `leclerc/parse.ts` | Pure parsing of pages and cart events. |
| `leclerc/locator.ts` | `find_stores` through `api-recherchemagasins` (fetched from a `www.leclercdrive.fr` page). |
| `leclerc/throttle.ts` | Serialized queue + min interval + jitter + backoff. |
| `store.ts` | Active store, persisted to `~/.mcp-leclerc-drive/config.json`. No store chosen = `current()` throws. |
| `config.ts` | `LECLERC_*` environment variables, validated. |

Claude Desktop bundle: `mcpb/manifest.json` + `scripts/build-mcpb.mjs` (`npm run bundle`); a new
tool or prompt must be added to the manifest (contract test).

Tests: `test/` (`npm test`), mostly against `test/fake-chrome.ts`. Live checks: `npm run smoke`.

API reference: `docs/api-capture.md`.

## Known traps

- One tab per server: the store client and the locator navigate it back and forth between the
  store host and `www.leclercdrive.fr`.
- Every page carries the cart (`lstProduits`): cut it out before scanning for search results.
- An unknown product id comes back as a line at 0, not an error.
- Relays share their drive's `noPL`; `find_stores` keys them `noPL-noPR`.
- Chrome does not write `DevToolsActivePort` for a fixed port (macOS, Chrome 154): ownership is
  proven by the DevTools browser id in the lock.
- `iQuantite` is an **absolute target quantity**, not a delta.
- A search with no result still carries products: the `ucZeroResultat` panel's suggestions.
- `www.leclercdrive.fr` lands on `/?mag=<noPL>-<noPR>`: the drive the session is on.
- Store pages say `"fClientConnecte":true|false`; a logged-out visitor still has a cart.
- `promotions.aspx` is about 24 MB (1 800 products): one request, cached 10 minutes.
- The path slug (`magasin-053701-053701-La-Ville-aux-Dames`) is cosmetic: only the host matters.
- The locator can return a generic host (`fd1-courses`) that 302s to the real shard, so several
  stores share the same requested origin (issue #1).
- After ~16 min idle, the store host may redirect to `fdN-secure`, which an in-page fetch cannot
  follow (issue #2).

## Tasks

✅ done · 🔄 in progress · ⏳ to do

| # | Task | Status |
| --- | --- | --- |
| 0 | Setup: read the code, this file, clean `dist/` before each build | ✅ |
| 1 | Issue #1: remember where the page landed, build URLs on the real origin, persist the corrected host | ✅ |
| 2 | Issue #2: on "Failed to fetch", re-navigate to the store and retry once (keep the 403/429 retry) | ✅ |
| 3 | Hardening: port 9333, PID+port lock in the profile, host allowlist (navigation, fetch, set_store, LECLERC_HOST), refuse the main Chrome profile | ✅ |
| 4 | `add_many` tool: sequential, throttled, carries on after a failure, per-item result + final cart | ✅ |
| 5 | Product details: inspect raw `objElement` fields (1-2 live searches), expose only what exists | ✅ |
| 6 | Wrap-up: README, summary since `ac341d7`, grep for URLs outside the allowlist in `src/` and `dist/` | ✅ |
| + | Carte blanche (2026-11-01): bug fixes, tests, CI/CD, branch protection, SECURITY/CONTRIBUTING, portfolio page | ✅ (v0.4.0 released 2026-11-01) |
| 7 | 0.5.0 (2026-11-11): sort, usual products, `diagnostic`, `courses` prompt, changed-page errors, no default drive, `.mcpb` bundle, French README, `browse_offers`, session drive in `find_stores`/`set_store`, login warning, zero-result fix | ✅ (v0.5.0 released 2026-11-11, bundle tested in Claude Desktop). Aisle browsing left out: the aisle menu is not in the pages. |
