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
