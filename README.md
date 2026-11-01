<h1 align="center">mcp-leclerc-drive</h1>

<p align="center">
  <strong>Fill your E.Leclerc Drive cart from Claude.</strong><br>
  An MCP server that finds your drive, searches the shelves and adds to your cart, through your own Chrome. Nothing past the cart: you check out yourself.
</p>

<p align="center">
  <a href="https://github.com/lborruto/mcp-leclerc-drive/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/lborruto/mcp-leclerc-drive/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="LICENSE"><img alt="Licence: MIT" src="https://img.shields.io/badge/licence-MIT-blue.svg"></a>
</p>

```text
You     J'ai besoin de beurre doux et d'un pack d'eau gazeuse.

Claude  ▸ search_product « beurre doux »
        Beurre Extra fin Les Croisés Doux - 82 % MG - 125g — 1,49 € [11,92 € / kg] · 0,125 kg · Cremerie · 4/5 (15 avis) id=29856
        Beurre Extra fin Les Croisés Doux - 82% MG - 250g — 2,35 € [9,40 € / kg] · 0,25 kg · Cremerie · 4/5 (87 avis) id=2111
        Beurre Tendre Les Croisés Doux - 82% MG - 250g — 2,51 € [10,04 € / kg] · 0,25 kg · Cremerie · 3,5/5 (62 avis) id=983
        …
        ▸ add_to_cart 28099 ×2
        Ajouté — Eau minérale gazeuse St Diery Naturelle - 6x1,25L (id=28099) : 2 au panier, 4,32 €.
```

<sub>Tool output from a live test on 1 November 2026 (store and prices of that day).</sub>

## What it does

- **Finds your drive.** By postcode or town, nearest first, then remembers the one you pick.
- **Searches the shelves.** Price, price per kilo or litre, pack size, family, customer rating,
  instant discounts, stock, and what is already in your cart.
- **Fills the cart.** Add one product or up to 30 in one go, set a quantity, remove a line,
  read the cart and its total. Every change is confirmed by Leclerc Drive; anything it kept
  short (stock, limits) is said.
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

**1. Add it to Claude Code**, from the latest release (built and attested by GitHub Actions):

```bash
claude mcp add --scope user leclerc-drive -- npx -y \
  --package=https://github.com/lborruto/mcp-leclerc-drive/releases/download/v0.4.0/mcp-leclerc-drive-0.4.0.tgz \
  mcp-leclerc-drive
```

> Not `npx mcp-leclerc-drive` on its own: that name on npm is the original, unmaintained 0.3.0,
> without these fixes and checks. This project is never published to npm. To check the tarball
> was built by this repository's release workflow: `gh attestation verify
> mcp-leclerc-drive-0.4.0.tgz -R lborruto/mcp-leclerc-drive`.

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
le beurre ». Then open the cart on leclercdrive.fr and check out yourself.

**Claude Desktop** and other clients: add it to the client's MCP configuration, for example
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "leclerc-drive": {
      "command": "npx",
      "args": [
        "-y",
        "--package=https://github.com/lborruto/mcp-leclerc-drive/releases/download/v0.4.0/mcp-leclerc-drive-0.4.0.tgz",
        "mcp-leclerc-drive"
      ]
    }
  }
}
```

Run one MCP client with it at a time: they would share the same Chrome window.

## Tools

| Tool | What it does |
|---|---|
| `find_stores` | Drives near a postcode or town, nearest first, with the id to pick one. |
| `set_store` / `get_store` | Choose the drive (remembered across sessions) / show it. |
| `search_product` | Search the drive's catalogue: price, per-kilo price, size, family, rating, offers, stock, already in cart. |
| `add_to_cart` | Add units of one product, on top of what the cart holds. |
| `add_many` | Add up to 30 products in one go; one failure does not stop the rest. |
| `update_quantity` | Set a line to an exact quantity (0 removes it). |
| `remove_from_cart` | Remove a line. |
| `get_cart` | The cart, line by line, with the total. |

## Settings

Optional environment variables, set in the MCP client's configuration (`claude mcp add -e
NAME=value …`):

| Variable | Default | What it does |
|---|---|---|
| `LECLERC_CHROME_PATH` | Chrome's usual place | The Chrome to start, if yours is elsewhere. |
| `LECLERC_CHROME_PROFILE_DIR` | `~/.mcp-leclerc-drive/chrome` | The server's own Chrome profile, where your Leclerc login is kept. Never your main profile. |
| `LECLERC_CHROME_PORT` | `9333` | Chrome's local debug port. |
| `LECLERC_STORE_ID`, `LECLERC_HOST` | none | A drive to start with, instead of `set_store`. |

Throttling and retries have their own settings; see [CONTRIBUTING.md](CONTRIBUTING.md#configuration).

## Upgrading

Change the version in the `claude mcp add` command (remove the old entry with `claude mcp remove
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
version, your OS, Chrome version and the error text. Never your cookies, account, address or
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
