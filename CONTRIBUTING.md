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

<!-- TODO(main): the final list of LECLERC_* variables and their defaults (store, host, Chrome
path, profile directory, port 9333, headless, throttle knobs), or a pointer to the README section
that lists them. -->

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

<!-- TODO(main): where the unit tests live (test/ or next to the sources) and anything they
need, e.g. a fake CDP endpoint. -->

Live tests against Leclerc Drive are for changes to how the server talks to the site, and only
with your own logged-in session: `npm run smoke` adds one product to your real cart, reads it,
changes its quantity and removes it. Read `scripts/smoke-test.mjs` before running it, and keep it
to a few requests.

<!-- TODO(main): confirm npm run smoke stays, and what it does after the add_many change. -->

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

<!-- TODO(main): the allowlist, lock file and profile checks once they land (which file holds
them). -->

## Releasing

1. Bump `version` in `package.json` (and `npm install --package-lock-only` so the lock file
   follows).
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and start a new empty
   `## [Unreleased]` above it.
3. Merge to `main`, then tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. `release.yml` runs CI on the tagged commit, checks that `package.json` says `X.Y.Z`, builds
   and packs `mcp-leclerc-drive-X.Y.Z.tgz`, attests its build provenance and creates the GitHub
   release from the changelog section, with the tarball attached. A tag without its section, or
   with another version in `package.json`, fails on purpose. Nothing goes to npm.

<!-- TODO(main): server.json still names io.github.skunkobi/leclerc-drive and an npm package;
decide whether it stays, and bump its version here too if so. -->
