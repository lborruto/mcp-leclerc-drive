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
| `index.ts` | stdio MCP server, tool declarations (zod), text formatting. stdout is the MCP channel: logs go to stderr only. |
| `browser.ts` | `ChromeSession`: launches Chrome, native-WebSocket CDP, `fetch()` run through `Runtime.evaluate` in the tab. |
| `leclerc/client.ts` | Search (scrapes `objElement` records from the HTML), cart mutations (`panier.aspx?op=1`), cart read (`lstProduits`). |
| `leclerc/locator.ts` | `find_stores` through `api-recherchemagasins` (fetched from a `www.leclercdrive.fr` page). |
| `leclerc/throttle.ts` | Serialized queue + min interval + jitter + 403/429 backoff. |
| `store.ts` | Active store, persisted to `~/.mcp-leclerc-drive/config.json`. |
| `config.ts` | `LECLERC_*` environment variables. |

API reference: `docs/api-capture.md`.

## Known traps

- One shared CDP tab: the store client and the locator navigate it back and forth between the
  store host and `www.leclercdrive.fr`.
- `iQuantite` is an **absolute target quantity**, not a delta.
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
| 2 | Issue #2: on "Failed to fetch", re-navigate to the store and retry once (keep the 403/429 retry) | ⏳ |
| 3 | Hardening: port 9333, PID+port lock in the profile, host allowlist (navigation, fetch, set_store, LECLERC_HOST), refuse the main Chrome profile | ⏳ |
| 4 | `add_many` tool: sequential, throttled, carries on after a failure, per-item result + final cart | ⏳ |
| 5 | Product details: inspect raw `objElement` fields (1-2 live searches), expose only what exists | ⏳ |
| 6 | Wrap-up: README, summary since `ac341d7`, grep for URLs outside the allowlist in `src/` and `dist/` | ⏳ |
| + | Carte blanche (2026-11-01): bug fixes, tests, CI/CD, branch protection, SECURITY/CONTRIBUTING, portfolio page | ⏳ |
