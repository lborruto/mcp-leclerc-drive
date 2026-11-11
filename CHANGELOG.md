# Changelog

What changes from one release to the next, in plain words. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/). A tag `vX.Y.Z` creates the GitHub release, with the
`npm pack` tarball attached; the release takes its notes from that version's section below.
Nothing is published to npm.

Versions up to 0.3.0 are the original project by skunkobi
([skunkobi/mcp-leclerc-drive](https://github.com/skunkobi/mcp-leclerc-drive), MIT), which
published them to npm. This repository continues from 0.3.0.

## [Unreleased]

### Added

- A Claude Desktop bundle, `mcp-leclerc-drive-X.Y.Z.mcpb`, attached to each release: open it to
  install, no terminal and no JSON file. Built and attested like the tarball.
- Usual products: `save_usual`, `list_usuals`, `forget_usual` keep a short name (« lait ») for a
  product of your drive, on your computer only, so the weekly shop does not search again.
- `search_product` takes `sort`: `pertinence` (the site's order), `prix` or `prix_unite` (cheapest
  per kilo or litre first).
- `diagnostic`: versions, Chrome, the drive and whether the Leclerc session answers, in a text
  that is safe to paste in a bug report.
- A `courses` prompt: a shopping list to the cart, usual products first, nothing past the cart.
- A French README (`docs/README.fr.md`).

### Changed

- A fresh install no longer starts on a default drive: until you choose one, the tools ask for
  `find_stores` then `set_store` (the first search used to fail on a drive that was not yours).
- `add_many` says to look for a close product when one is missing or was reduced.

### Fixed

- If Leclerc Drive changes its pages, search and cart say so and ask to update or report, instead
  of answering « aucun produit » or an empty cart.

## [0.4.0] - 2026-11-01

First release of this continuation: the two open upstream issues fixed, the Chrome session
hardened, `add_many`, more product details, and tests, CI and signed releases. Install from the
release tarball or a clone, never `npx mcp-leclerc-drive` (that is upstream's 0.3.0 on npm).

### Added

- `add_many`: up to 30 products in one call, one after another; one failure does not stop the
  rest, a block (DataDome, expired session, Chrome gone) does. Each item's result and the final
  cart.
- Search results show the pack size, the product family, the customer rating, instant-discount
  offers and what is already in the cart. Only fields the site really sends: there is no brand or
  origin field, so none is shown.
- Tool titles and read-only / destructive hints, and server instructions for the model.
- Unit tests on a simulated browser and cart, a contract test on the tool list, and CI on Linux,
  macOS and Windows with gitleaks, CodeQL, npm audit and a host-allowlist check of the code.
  Releases come with build-provenance attestations.
- `search_product` takes `limit` (20 by default, up to 60) and `only_available`, lists available
  products first and says how many it left out: a search used to send every product on the page
  (often 50 to 200) to the model.
- `get_store` also says where the server's Chrome stands: connected, open, not started yet, or
  its port taken by another program.

### Changed

- `add_to_cart` adds on top of what the cart holds (« add 2 » to a line of 2 makes 4; it used to
  stay at 2). `update_quantity` sets an exact quantity.
- After a change, the tools report the changed line and the cart totals as Leclerc confirmed
  them, and say when Leclerc kept less than asked. They used to list one line with the whole
  cart's total.
- Chrome's debug port is 9333 by default (was 9222).
- The server works in its own tab, closed when the MCP client goes away.
- `find_stores` gives relays their own id (`noPL-noPR`): they share their drive's.
- Store client and store locator share one request queue.

### Fixed

- Stores whose host redirects to another shard: every call failed with « Failed to fetch »
  ([upstream #1](https://github.com/skunkobi/mcp-leclerc-drive/issues/1)).
- The first call after about 16 idle minutes failed with « Failed to fetch »
  ([upstream #2](https://github.com/skunkobi/mcp-leclerc-drive/issues/2)).
- Search results included the products already in the cart.
- An unknown product id was reported as added.
- Two cart changes at the same time could lose one; a `set_store` during a request could save
  the wrong host.
- Calls could hang forever on a closed Chrome window or a request Chrome never answered.
- `set_store 027411` could pick a relay instead of the drive.
- Product labels were HTML-decoded in several passes (`&#38;lt;` became `<`), and an
  out-of-range numeric entity threw and broke the whole search (found by CodeQL).

### Security

- Allowlist of Leclerc Drive hosts, checked before every navigation and request, on the page
  actually reached after redirects, inside the page for redirected requests, and on every host
  from outside the code.
- Never attaches to a Chrome it did not start (lock with PID, port and DevTools id); never runs
  on your main Chrome, Chromium, Edge or Brave profile.
- Checks inside the page that the tab is still on Leclerc Drive before each request.
- Dependencies updated past their advisories (MCP SDK 1.32, zod 4); `dist/` emptied before each
  build, so no leftover file (such as 0.3.0's `dist/auth/cookies.js`) ships.
- Never published to npm (`private`).

## [0.3.0] - 2026-07-11

Last release by skunkobi. Every request now runs inside a real Chrome driven over the Chrome
DevTools Protocol, with a dedicated profile you log into once: the only way past DataDome once it
blocks cookie replay. Reading cookies from your Chrome profile is gone (and with it
`LECLERC_COOKIE` and the native `sqlite3` dependency); Node 22 or later.

## [0.2.0] - 2026-06-14

Store locator: `find_stores`, `set_store` and `get_store` pick your drive by postal code or city,
and the choice is saved in `~/.mcp-leclerc-drive/config.json`.

## [0.1.2] - 2026-06-13

A DataDome challenge or an expired session is reported as such, instead of an empty search or an
empty cart. The server reports the version from `package.json`.

## [0.1.1] - 2026-06-13

Requests go one at a time, about a second apart with jitter, and back off on HTTP 403 and 429.
The vulnerabilities `npm audit` reported in build-time dependencies are fixed.

## [0.1.0] - 2026-06-13

First release: `search_product`, `add_to_cart`, `remove_from_cart`, `update_quantity` and
`get_cart`, using the Leclerc Drive session of your local Chrome.
