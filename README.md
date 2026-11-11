<h1 align="center">mcp-leclerc-drive</h1>

<p align="center">
  <strong>Fill your E.Leclerc Drive cart from Claude.</strong><br>
  An MCP server that finds your drive, searches the shelves and adds to your cart, through your own Chrome. Nothing past the cart: you check out yourself.
</p>

<p align="center">🇫🇷 <a href="docs/README.fr.md">Lire en français</a></p>

<p align="center">
  <a href="https://github.com/lborruto/mcp-leclerc-drive/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/lborruto/mcp-leclerc-drive/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="LICENSE"><img alt="Licence: MIT" src="https://img.shields.io/badge/licence-MIT-blue.svg"></a>
</p>

<p align="center"><img src="docs/screenshots/demo.svg" alt="A shopping conversation: Claude searches E.Leclerc Drive for butter, adds two packs of sparkling water to the cart, then lists the offers on ground coffee sorted by price per kilo. Nothing is ordered." width="980"></p>

<sub>Tool output from live runs on 1 and 11 November 2026 (store, prices and offers of those days), shortened to fit.</sub>

## What it does

- **Finds your drive.** By postcode or town, nearest first, then remembers the one you pick.
- **Searches the shelves.** Price, price per kilo or litre, pack size, family, customer rating,
  instant discounts, stock, and what is already in your cart. Cheapest first, or cheapest per
  kilo first, if you ask.
- **Fills the cart.** Add one product or up to 30 in one go, set a quantity, remove a line,
  read the cart and its total. Every change is confirmed by Leclerc Drive; anything it kept
  short (stock, limits) is said.
- **Remembers your usual products.** « Mémorise ce lait comme mon lait habituel » : next week,
  « ajoute mon lait » needs no search. Kept on your computer only.
- **Stops at the cart.** No tool validates the cart, books a slot, orders or pays. You check
  the cart and finish on the site, as usual.
- **Through your own Chrome.** The server opens a Chrome window with its own profile; you log
  into Leclerc Drive there once and it stays logged in. Requests go out one at a time, spaced
  like a person's.
- **French**, like the site: the tools answer in French; ask Claude in any language.

## Security

Read this before you install.

- **It never sees your password.** You log in yourself, in the Chrome window it opens. Your
  session stays in that dedicated Chrome profile (`~/.mcp-leclerc-drive/chrome`); the server
  never reads, stores or logs a cookie, a password or a 2FA code.
- **It only talks to Leclerc Drive.** Every page and request is checked against a short list of
  `leclercdrive.fr` hosts, even after redirects. No telemetry, no other site.
- **Your main Chrome is never touched.** The server refuses to use your everyday Chrome profile,
  and never connects to a Chrome it did not start.
- **Cart changes are real.** It is your Leclerc cart. Product names come from the site and are
  shown to the model as data; check the cart before you check out.
- **While it runs, the window is drivable from this computer.** Chrome listens on a local debug
  port (127.0.0.1:9333) so the server can drive it; another program running as you on this
  computer could too. Close the window when you are done shopping.

The details, and how to report a vulnerability: [SECURITY.md](SECURITY.md).

## Get started

**You need:** Node.js 22 or later, Google Chrome, a Leclerc Drive account, and an MCP client
such as [Claude Code](https://claude.com/claude-code) or Claude Desktop.

**1a. Claude Desktop, no terminal:** download `mcp-leclerc-drive-0.5.0.mcpb` from the
[latest release](https://github.com/lborruto/mcp-leclerc-drive/releases/latest) and open it (or
drag it into Claude Desktop's Settings › Extensions), then go to step 2.

**1b. Claude Code**, from the latest release (built and attested by GitHub Actions):

```bash
claude mcp add --scope user leclerc-drive -- npx -y \
  --package=https://github.com/lborruto/mcp-leclerc-drive/releases/download/v0.5.0/mcp-leclerc-drive-0.5.0.tgz \
  mcp-leclerc-drive
```

> Not `npx mcp-leclerc-drive` on its own: that name on npm is the original, unmaintained 0.3.0,
> without these fixes and checks. This project is never published to npm. To check the tarball
> was built by this repository's release workflow: `gh attestation verify
> mcp-leclerc-drive-0.5.0.tgz -R lborruto/mcp-leclerc-drive`.

**Or from a clone**, to read the code first or follow `main`:

```bash
git clone https://github.com/lborruto/mcp-leclerc-drive.git && cd mcp-leclerc-drive
npm ci            # also builds dist/
claude mcp add --scope user leclerc-drive -- node "$PWD/dist/index.js"
```

**2. Log in once.** Ask Claude something that needs the site (« trouve les drives autour de
74100 »). A Chrome window opens: log into Leclerc Drive in it and choose your drive. Leave the
window open while you shop; your login is kept for next time.

**3. Pick your drive** in Claude: « find_stores 74100 », then « set_store 027411 » with the id it
shows. The shopping works on the drive the Chrome window is logged into.

**4. Shop.** « Ajoute 2 packs de lait et du beurre », « qu'y a-t-il dans mon panier ? », « enlève
le beurre ». Or hand over the whole list with the `courses` prompt (in Claude Code:
`/mcp__leclerc-drive__courses`). Then open the cart on leclercdrive.fr and check out yourself.

**Other clients** (or Claude Desktop by hand): add it to the client's MCP configuration, for
example `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "leclerc-drive": {
      "command": "npx",
      "args": [
        "-y",
        "--package=https://github.com/lborruto/mcp-leclerc-drive/releases/download/v0.5.0/mcp-leclerc-drive-0.5.0.tgz",
        "mcp-leclerc-drive"
      ]
    }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `find_stores` | Drives near a postcode or town, nearest first, with the id to pick one. |
| `set_store` / `get_store` | Choose the drive (remembered across sessions) / show it. |
| `search_product` | Search the drive's catalogue: price, per-kilo price, size, family, rating, offers, stock, already in cart. Sorted by relevance, price or per-kilo price. |
| `browse_offers` | The products on offer in your drive, filtered by words if you give some. |
| `add_to_cart` | Add units of one product, on top of what the cart holds. |
| `add_many` | Add up to 30 products in one go; one failure does not stop the rest. |
| `update_quantity` | Set a line to an exact quantity (0 removes it). |
| `remove_from_cart` | Remove a line. |
| `get_cart` | The cart, line by line, with the total. |
| `list_usuals` / `save_usual` / `forget_usual` | Your usual products: a short name for a product, per drive, kept on your computer. |
| `diagnostic` | Checks the install (versions, Chrome, drive, session). Safe to paste in a bug report. |

And one prompt, `courses`: give it your shopping list, it fills the cart (usual products first)
and stops there.

## Settings

Optional environment variables, set in the MCP client's configuration (`claude mcp add -e
NAME=value …`):

| Variable | Default | What it does |
|---|---|---|
| `LECLERC_CHROME_PATH` | Chrome's usual place | The Chrome to start, if yours is elsewhere. |
| `LECLERC_CHROME_PROFILE_DIR` | `~/.mcp-leclerc-drive/chrome` | The server's own Chrome profile, where your Leclerc login is kept. Never your main profile. |
| `LECLERC_CHROME_PORT` | `9333` | Chrome's local debug port. |
| `LECLERC_STORE_ID`, `LECLERC_HOST` | none | A drive to start with, instead of `set_store`. Without either, the tools ask you to pick one. |

Throttling and retries have their own settings; see [CONTRIBUTING.md](CONTRIBUTING.md#configuration).

## Good to know

- **One drive at a time.** Your Leclerc session is tied to the drive chosen on the site.
  `find_stores` marks the drive the Chrome window is on, and `set_store` warns when you pick
  another one: to shop there, choose it in the Chrome window too; otherwise Leclerc answers with an
  expired-session page.
- **Logged out?** The cart tools say so when nobody is logged in in the Chrome window: the cart
  they fill is then a visitor's, not your account's.
- **Blocked or logged out?** If a tool says Leclerc Drive blocked it or the session expired,
  reload the page in the server's Chrome window (log in again if asked) and retry. Keep the pace
  of a person: one shopping list at a time.
- **Quantities are checked by Leclerc.** If a product is short or limited, the tool says how
  many went into the cart. Prices are the site's at the time of the search.
- **Relays have their own id.** `find_stores` lists truck and pedestrian relays as
  `027411-027499`: they share their drive's number.
- **Shop from one Claude session at a time.** Several sessions share the same Chrome and login,
  each in its own tab, but each paces only its own requests.

## Upgrading

In Claude Desktop, open the new release's `.mcpb` file. In Claude Code, change the version in the `claude mcp add` command (remove the old entry with `claude mcp remove
leclerc-drive`), or `git pull && npm ci` in your clone. What changed is in
[CHANGELOG.md](CHANGELOG.md). Your login and your drive are kept.

## Help and docs

| I want to… | Read |
|---|---|
| Know what it protects and what it does not | [SECURITY.md](SECURITY.md) |
| Report a vulnerability, privately | [SECURITY.md › Reporting](SECURITY.md#reporting-a-vulnerability) |
| Hack on it, run the tests, see how it works | [CONTRIBUTING.md](CONTRIBUTING.md) |
| See how the Leclerc Drive site was mapped | [docs/api-capture.md](docs/api-capture.md) |
| See what changed in each version | [CHANGELOG.md](CHANGELOG.md) |

Found a bug? [Open an issue](https://github.com/lborruto/mcp-leclerc-drive/issues) with the
output of the `diagnostic` tool (« lance le diagnostic ») and the error text. Never your cookies, account, address or
screenshots of your logged-in account.

## Licence and credits

MIT, see [LICENSE](LICENSE). Started from [skunkobi/mcp-leclerc-drive](https://github.com/skunkobi/mcp-leclerc-drive)
0.3.0 (MIT), which mapped the site and found how to work through a real Chrome; this project
continues it, with its history.

## Not affiliated, no warranty

An independent, unofficial project. It is not made, endorsed or supported by E.Leclerc,
DataDome, Google or Anthropic; the names are theirs, used here only to say what it works with.
It drives a website that can change at any time, with no warranty of any kind: check your cart
before you order.
