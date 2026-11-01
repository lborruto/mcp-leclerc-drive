# Security policy

## Reporting a vulnerability

Please report privately through GitHub: **Security › Report a vulnerability**
(https://github.com/lborruto/mcp-leclerc-drive/security/advisories/new). Do not open a public
issue. Include the version (the release tag or the commit), what an attacker needs (code running
as you, a product page they control, access to your machine) and the steps. Never include your
cookies, account details or captures of your session: they are not needed. mcp-leclerc-drive is
maintained in spare time: reports are handled on a best-effort basis, with no guaranteed response
time.

## Supported versions

The latest release only: the most recent `vX.Y.Z` tag and its tarball on the
[releases page](https://github.com/lborruto/mcp-leclerc-drive/releases). Fixes land on `main` and
in the next release; older tags are not patched. This continuation is not published to npm: the
`mcp-leclerc-drive` package there is the original project's (skunkobi, 0.3.0 and earlier) and gets
none of these fixes. Each release tarball comes with a build provenance attestation:
`gh attestation verify mcp-leclerc-drive-X.Y.Z.tgz --repo lborruto/mcp-leclerc-drive`.

## Security model

Read this before installing. mcp-leclerc-drive is an unofficial MCP server that fills your E.Leclerc
Drive cart by driving your own Google Chrome. It is not affiliated with, endorsed by or supported
by E.Leclerc, DataDome or Google.

- **Local only, a short allowlist.** The server runs on your machine and speaks MCP over stdio to
  the client that started it; it opens no port of its own. It talks to two things only: the
  Leclerc Drive hosts (`fdN-courses.leclercdrive.fr` and `fdN-secure.leclercdrive.fr`,
  `www.leclercdrive.fr`, `api-recherchemagasins.leclercdrive.fr`) and Chrome on `127.0.0.1`. No
  telemetry, no update check, no other network call. The allowlist is enforced in the code before
  every navigation and every request, on the URL the page actually lands on after redirects, and
  on every host that comes from outside the code: `set_store`, `LECLERC_HOST`, the saved
  configuration and the store locator's answers. CI checks the sources and the build for any
  other host.
- **It never sees your password, cookies or 2FA codes.** You log in yourself, in the Chrome window
  the server opens. The session lives in that dedicated Chrome profile (by default
  `~/.mcp-leclerc-drive/chrome`), not in the server: requests run as `fetch` inside the page, so
  the browser attaches its own cookies. The server refuses to run Chrome on your main Chrome
  profile.
  <!-- TODO(main): confirm the profile default and the env var that overrides it
  (LECLERC_CHROME_PROFILE_DIR today), and how "main profile" is detected. -->
- **The debugging port is open to your user account.** Chrome is started with a remote debugging
  port (9333 by default, `LECLERC_CHROME_PORT`), which Chrome binds to `127.0.0.1`. While that
  Chrome runs, any program running as your user on this machine can connect to the port and drive
  that Chrome profile, which is logged into Leclerc Drive. The server writes a lock file in the
  profile (Chrome's process id and port) and refuses to attach to a Chrome on that port that it did
  not start: no lock file, another port, a process that is gone, or Chrome's own
  `DevToolsActivePort` file not matching. Close that Chrome window when you are done to close the
  port.
- **Nothing past the cart.** No tool validates the cart, picks a slot, places an order or pays:
  the server fills the cart, you check out yourself on the site. Cart changes are real: they
  change your Leclerc Drive cart, the one you see on the site.
- **Paced like a person.** Requests go one at a time, with a minimum interval and random jitter
  between them, and back off on HTTP 403 and 429. Bulk adds (`add_many`) are capped.
  <!-- TODO(main): the add_many cap and the throttle defaults (LECLERC_MIN_INTERVAL_MS,
  LECLERC_JITTER_MS, LECLERC_MAX_RETRIES), if this document should quote them. -->

### What it does not protect against

- Malware or any program running as your user: it can use the debugging port while Chrome runs,
  or read the Chrome profile (and the session in it) at any time.
- Someone with access to your unlocked machine: the Chrome window is logged into your account.
- Leclerc Drive changing its site: a tool can break or misread a page until the server is
  updated.
- DataDome, Leclerc's anti-bot service, blocking your account or your IP address. The throttling
  makes it unlikely, not impossible.
- Prompt injection through product text. Product names and descriptions are third-party text and
  go to the model as they are; the model decides what to add. Review the cart on the site before
  you check out.

## In scope

The server's code, the Chrome launch, lock file and profile checks, the host allowlist (in the
code and in `scripts/check-hosts.mjs`), the GitHub workflows and the release tarball.

## Out of scope

- Leclerc Drive and DataDome themselves: report to E.Leclerc.
- Google Chrome and its remote debugging protocol: report to Google.
- The MCP client (Claude Desktop, Claude Code, …): report to its vendor.
- Attacks that need code execution as your user, or physical access to your unlocked machine.
- A package or fork distributed from somewhere else than this repository's releases.
