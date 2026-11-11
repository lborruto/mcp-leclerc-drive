# Contributing to mcp-leclerc-drive

Thanks for helping. mcp-leclerc-drive drives a Chrome that is logged into someone's grocery
account, so the bar is: nothing past the cart, nothing that touches credentials, no host outside
the allowlist, and every change tested without hammering Leclerc Drive.

It is meant to stay small: search products and fill the cart from an MCP client, nothing more. A
new tool has to fit that.

Contents: [Set up](#set-up) · [Checks](#checks) · [Principles](#principles) ·
[Commits and pull requests](#commits-and-pull-requests) ·
[Never commit secrets or real data](#never-commit-secrets-or-real-data) ·
[How it works](#how-it-works) · [Releasing](#releasing).

## Set up

You need Node.js 22 or later and Google Chrome. Nothing else: the server has two runtime
dependencies (`@modelcontextprotocol/sdk`, `zod`) and talks to Chrome with Node's built-in
WebSocket.

    git clone https://github.com/lborruto/mcp-leclerc-drive.git && cd mcp-leclerc-drive
    npm ci
    npm run build

`npm run build` empties `dist/` and compiles `src/` into it; point your MCP client at
`node /path/to/mcp-leclerc-drive/dist/index.js` (the README shows the client configuration). The
server reads its settings from `LECLERC_*` environment variables.

### Configuration

All optional, read once at start (`src/config.ts`); an invalid value stops the server with a
message rather than being ignored.

| Variable | Default | What it does |
|---|---|---|
| `LECLERC_STORE_ID` | `053701` | Store id (digits) used until `set_store` picks one. |
| `LECLERC_HOST` | `fd9-courses.leclercdrive.fr` | That store's host; must be an `fdN-courses.leclercdrive.fr`. |
| `LECLERC_CHROME_PATH` | Chrome's usual path for the OS | The Chrome binary. |
| `LECLERC_CHROME_PROFILE_DIR` | `~/.mcp-leclerc-drive/chrome` | The dedicated profile. A browser's main profile is refused. |
| `LECLERC_CHROME_PORT` | `9333` | Chrome's debug port, 1024 to 65535. |
| `LECLERC_HEADLESS` | `false` | Headless Chrome. DataDome tends to block it; for experiments only. |
| `LECLERC_MIN_INTERVAL_MS` | `1000` | Minimum gap between two requests. |
| `LECLERC_JITTER_MS` | `400` | Random extra gap, 0 to this. |
| `LECLERC_MAX_RETRIES` | `3` | Retries on HTTP 403/429. |
| `LECLERC_BACKOFF_BASE_MS` | `1500` | First retry delay, doubled each time. |

The chosen store is saved in `~/.mcp-leclerc-drive/config.json` and wins over the two store
variables; a saved host outside the allowlist is ignored. With no saved store and no
`LECLERC_STORE_ID`, the store tools refuse to run and ask for `find_stores` then `set_store`.
Usual products are saved in `~/.mcp-leclerc-drive/habituels.json`, per store.

## Checks

Run these before opening a pull request:

    npm run typecheck     # tsc, no output
    npm run build         # clean dist/, then tsc
    npm test              # unit tests (node's built-in runner): no network, no Chrome
    npm run check:hosts   # every URL and leclercdrive.fr host in src/ and dist/ is allow-listed

CI runs the same on Linux (Node 22 and 24), macOS and Windows (Node 24), plus: the contents of
the release tarball (`scripts/check-pack.mjs`), `npm audit` on the runtime dependencies, gitleaks
over the whole history, actionlint on the workflows and CodeQL. The one check to require is
"CI result"; a docs-only pull request skips the build jobs and still passes it.

The tests live in `test/` and need nothing but Node: `npm test` builds, compiles `src/` and
`test/` to `build-test/`, and runs Node's test runner. Most of them run the real `ChromeSession`,
client and locator against `test/fake-chrome.ts`, a simulated browser that answers the CDP calls:
navigations follow redirects, and the script the server sends into the page really runs (in a
`node:vm` sandbox) against a fetch that is same-origin only, like Chrome without CORS. A site is a
small function from URL to response (`test/cart.test.ts` has a whole simulated cart). The contract
test starts `dist/index.js` over stdio and checks the exact tool list. A bug fix comes with the
test that fails without it.

Live tests against Leclerc Drive are for changes to how the server talks to the site, and only
with your own logged-in session: `npm run smoke` adds one product to your real cart, reads it,
changes its quantity and removes it. Read `scripts/smoke-test.mjs` before running it, and keep it
to a few requests.

`npm run smoke [term]` reads the cart, searches, picks an available product that is not in it,
adds one twice, sets it to one, removes it, and reads the cart again: about ten requests, and the
cart ends as it started.

## Principles

These are permanent. A change that needs one of them relaxed needs a conversation first, in an
issue.

- **Nothing past the cart.** Never a tool that validates the cart, picks a slot, places an order
  or pays. The user checks out on the site.
- **Never touch credentials.** Nothing reads, stores or logs a password, a cookie or a 2FA code.
  The user logs in in the Chrome window; requests run inside the page, which carries its own
  cookies. That includes logs and error messages: never dump a request's headers or a page's
  cookies to stderr.
- **The network allowlist.** The server talks to `fdN-courses.leclercdrive.fr`,
  `fdN-secure.leclercdrive.fr`, `www.leclercdrive.fr`, `api-recherchemagasins.leclercdrive.fr`
  and Chrome on `127.0.0.1`, and nothing else. No telemetry. The check runs in the code on every
  navigation and request; `npm run check:hosts` keeps any other host out of the sources.
- **No new dependency without discussion.** Today: `@modelcontextprotocol/sdk` and `zod` (dev:
  `typescript`, `@types/node`). Node's standard library goes a long way; a new package needs an
  issue first, with the reason.
- **No npm publication.** The package is `"private": true`; it is installed from this repository
  or from a release tarball.
- **Paced like a person.** Keep the throttling (one request at a time, a minimum interval, jitter,
  backoff on 403 and 429). No bulk loops, no parallel requests; `add_many` stays sequential and
  capped.
- **Every fix comes with a unit test** that fails before the fix and passes after it; a feature
  adds its tests the same way. Unit tests never touch the network or a real Chrome.
- **Live tests only with your own session**, logged in in the server's Chrome window, with few
  requests. Never against someone else's account.

## Commits and pull requests

- One change per commit, with a subject line that says what changed, in plain words, as in
  `Remember where the page landed and build URLs on the real origin`. Say why in the body when
  it is not obvious.
- One topic per pull request, with its tests. Fill in the template's checklist.
- Keep `CHANGELOG.md` current: a change users will notice adds a line under `## [Unreleased]`.

## Never commit secrets or real data

- No cookie, session token, account email, address, order, loyalty-card number or screenshot of a
  logged-in account in code, tests, docs, issues or commit messages. Test fixtures are invented
  or stripped down to the fields the test needs.
- No network capture. HAR files and the `captures/` folder are gitignored (they hold session
  cookies); keep them so, and describe a request in words or as a trimmed shape in
  `docs/api-capture.md`.
- `.env` files are gitignored. CI runs gitleaks over the whole history with the default rules.
- Found something sensitive in the history? Report it privately (see `SECURITY.md`).

## How it works

- **`src/browser.ts`**, the CDP session: launches Chrome with the dedicated profile and a debugging
  port on `127.0.0.1`, connects with Node's built-in WebSocket, navigates the one shared tab and
  runs `fetch` inside it through `Runtime.evaluate`, so DataDome sees a real browser.
- **`src/leclerc/`**: `client.ts` (search, cart changes, cart read on the store host),
  `locator.ts` (the store finder behind `find_stores`), `throttle.ts` (the serialized queue,
  interval, jitter and backoff).
- **`src/index.ts`**: the stdio MCP server and the tool declarations. stdout is the MCP channel:
  logs go to stderr only.
- **`docs/api-capture.md`**: the reverse-engineered Leclerc Drive API, read it before touching the
  client.
- **`scripts/`**: `check-hosts.mjs` and `check-pack.mjs` (CI checks, no dependency) and
  `smoke-test.mjs` (the live test).

- **`src/hosts.ts`**: the host allowlist and store id rules. **`src/chrome-profile.ts`**: the
  main-profile guard and the lock (PID, port, the browser's DevTools id) that keeps the server off
  any Chrome it did not start. **`src/errors.ts`**: `BlockingError`, for failures every following
  request would hit (a batch stops there).
- **`src/leclerc/http.ts`**: the one way requests leave: shared throttle, 403/429 backoff, one
  re-navigation on "Failed to fetch" or a tab found elsewhere.

## Why no Docker image

Asked, and declined for now. The server starts and drives a Chrome on your machine, and that is
the part a container cannot do well:

- From a container, the server cannot start your Chrome; you would start it by hand with the
  right flags first.
- Chrome's debug port listens on the host's 127.0.0.1 only, and Chrome refuses DevTools requests
  addressed by a host name such as `host.docker.internal`. Reaching it from a container means
  opening the port beyond loopback: the exposure the port and lock checks exist to avoid.
- The ownership checks (Chrome's PID alive, the lock in the profile) and the main-profile guard
  read the host's processes and files.
- Chrome inside the image instead (with a virtual display and a web viewer to log in) is a large
  image, another login surface, and on Apple Silicon a different browser than Google Chrome,
  which DataDome may treat differently.

The install is one `claude mcp add … npx --package=<release tarball>` line already. A headless
server variant could be revisited if someone needs it and can test it against DataDome.

## Releasing

1. Bump `version` in `package.json` (and `npm install --package-lock-only` so the lock file
   follows).
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and start a new empty
   `## [Unreleased]` above it.
3. Merge to `main`, then tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. `release.yml` runs CI on the tagged commit, checks that `package.json` says `X.Y.Z`, builds
   and packs `mcp-leclerc-drive-X.Y.Z.tgz`, builds the Claude Desktop bundle
   `mcp-leclerc-drive-X.Y.Z.mcpb` (`scripts/build-mcpb.mjs`: `dist/`, the production dependencies
   and `mcpb/manifest.json`, zipped; `npm run bundle` builds it locally), attests the build
   provenance of both and creates the GitHub release from the changelog section, with both
   attached. A new tool or prompt goes in `mcpb/manifest.json` too (a test checks it). A tag without its section, or
   with another version in `package.json`, fails on purpose. Nothing goes to npm.

There is no MCP registry manifest (`server.json`) and no npm package: the release tarball, the
Claude Desktop bundle and the repository are the only ways to install. Update the version in
`README.md` and `docs/README.fr.md` with the bump.
