# Leclerc Drive — Reverse-engineered API (validated 2026-06-13)

Captured live against store **053701** (La Ville-aux-Dames) on host
`fd9-courses.leclercdrive.fr`. All endpoints below were observed AND replayed
successfully from the page context with `credentials: 'include'` (cookies,
incl. DataDome, replayed).

> Path note: the store path is `magasin-{id}-{id}` for the API (e.g.
> `magasin-053701-053701`). The trailing `-La-Ville-aux-Dames` slug appears in
> the HTML page URLs but is **cosmetic** — the backend keys off the id.

## 0. Auth / anti-bot

- ✅ **v0.3 (current): requests run inside a real Chrome via CDP** (see
  `src/browser.ts`), so they carry the browser's cookies + TLS fingerprint +
  solved DataDome challenge. This is the only approach that survives DataDome's
  *active* mode. The cookie-replay notes below document the earlier (v0.1–0.2)
  approach and why it was abandoned.
- ⚠️⚠️ **DataDome escalates to "active" mode and then cookie-replay is dead.**
  After enough automated traffic (and it hits real end users too), DataDome stops
  accepting the cookie alone and requires the JS challenge to be executed. Then a
  Node `fetch` gets **403 even with a fresh, browser-valid `datadome` cookie and
  a changed IP**, while the real browser still loads fine. Not recoverable by
  refreshing Chrome. → v0.3 fixes this by *being* a real browser.
- [v0.1–0.2, superseded] Session was cookie-based: replay the full `Cookie`
  header from a logged-in browser.
- ⚠️ **DataDome** bot protection is active (`api-js.datadome.co/js/`). A
  `datadome` cookie is part of the session and **must** be replayed, or requests
  will be challenged. Confirmed: a cold Node `fetch` (no cookies) gets **HTTP
  403** with a DataDome challenge; replaying the browser cookies (incl.
  `datadome`) returns the real **HTTP 200** page. This is the main fragility of
  the cookie-replay approach.
- [v0.1–0.2, removed] Those versions read the cookies from the local Chrome
  profile. Since v0.3 no cookie is read, stored or logged: the requests run in
  the browser, which attaches its own.
- ⚠️ **Bursts get struck.** Observed live: firing ~5 cart mutations in parallel
  immediately triggered DataDome — both writes *and* subsequent reads returned
  403 for that client, while the real browser session stayed fine. Recovery:
  refresh Leclerc Drive in Chrome (re-issues a valid `datadome` cookie). The
  client now serializes + spaces out + retries all requests (store and locator
  share one queue) to avoid this — see `src/leclerc/throttle.ts` and
  `src/leclerc/http.ts`. Keep a human-like cadence; don't parallelize.
- Mutating requests send header `X-Requested-With: XMLHttpRequest` and
  `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`.

## 1. search_product — `GET .../recherche.aspx?TexteRecherche={query}`

- Server-rendered HTML (ASP.NET). **No separate search XHR.**
- Needs the session cookie (DataDome blocks anonymous fetches), but no account
  is required beyond a valid browser session.
- In the **raw HTML**, products are passed to widget init calls as
  `Utilitaires.widget.initOptions('..._pnlElementProduit', {"objContenu":{"lstElements":[{"objElement":{ ...iIdProduit... }}]}})`.
  (The `_objDataSourceGroupeTrieFiltre` name only exists as a client-side global
  built from this — don't key off it server-side.) The client extracts products
  by scanning the HTML for the smallest JSON object enclosing each `iIdProduit`
  (= `objElement`, pure JSON). Validated live: `search("café")` → 200 products.
  Each product object exposes:

  | Field | Meaning |
  | --- | --- |
  | `iIdProduit` | **product id** (used for all cart ops), e.g. `2612` |
  | `sLibelleLigne1`, `sLibelleLigne2` | label (2 lines) |
  | `nrPVUnitaireTTC` / `sPrixUnitaire` | unit price (numeric / formatted) |
  | `sPrixPromo` | promo price when applicable |
  | `nrPVParUniteDeMesureTTC` / `sPrixParUniteDeMesure` | price per L/kg |
  | `iQteDisponible` | stock available (0 → unavailable) |
  | `iQuantitePanier` | quantity currently in cart |
  | `sUrlVignetteProduit` | thumbnail URL |
  | `iIdRayon`, `iIdFamille`, `niIdSousFamille` | category ids |

- **Fields seen live (2026-11-01, store 027411, two searches)**, beyond the
  table: `sTexteLogoCoupon` (offer text, e.g. "Bénéficiez de 0.40 € de remise
  immédiate."), `sPrixPromo` (always `0,00 €` in what was seen: its meaning
  when non-zero is unknown, so it is not exposed), `sUrlVoirRayon`
  (`…/rayon-<iIdFamille>-<Family-Name>.aspx`: the only place the family is
  named, as an accent-less slug; the parent `iIdRayon` has no name in the
  record, so fresh vs frozen cannot be told reliably), `nrContenanceTotale` +
  `sUniteMesureTotale` (pack size: `0.6`/`kg`, `6`/`l`, `p` = pieces),
  `objAvisClient` (`Note.Valeur` stars, `NbAvis` reviews), `iQteMaxPanier`,
  `eDisponibilite`, `sCategorie`, `niIdPhotoEnLigne`, `lstMentionsProduit`
  (empty in all seen). **No brand field and no origin field**: both only
  appear inside the label.
- ⚠️ Every page also carries the cart (§3): its `lstProduits` records look
  exactly like search results. The search cuts the cart context out before
  scanning, or cart lines show up as results.
- Product images also load from
  `fd9-photos.leclercdrive.fr/image.ashx?id={photoId}&use=l&cat=p` and
  Nutri-Score from `...&use=nsc` (note: photo id ≠ `iIdProduit`).

## 2. add / update / remove — `POST .../panier.aspx?op=1`

Single endpoint for all cart mutations. `op=1` constant.

- **Body**: `d=<URL-encoded JSON>` (one form field named `d`).
- **JSON payload**:

  ```json
  {
    "eTypeAction": 1,
    "iIdProduit": "2612",
    "iQuantite": 2,
    "sNoPointLivraison": "053701",
    "objContexteProvenanceArticle": {
      "eOrigine": 4, "eTypePage": 3,
      "sTexteRecherche": "lait", "eVue": 0,
      "sInformationsComplementaires": "uni-2"
    }
  }
  ```

  - `eTypeAction`: **1** = add / increase, **2** = decrease / remove.
  - `iQuantite`: the **new absolute target quantity** (NOT a delta).
  - **Remove** = `eTypeAction: 2`, `iQuantite: 0`. ✅ validated (cart went to 0).
  - Unknown product id: **no error**, a `Produit{id}` event with
    `iQuantitePanier: 0` (seen live 2026-11-01). The client treats "asked for
    more than 0, line at 0" as a failure.
  - `objContexteProvenanceArticle` is analytics context and is **optional** —
    removals succeeded without it.

- **Response**: JSON array of events. Relevant ones, keyed by `sIdUnique`:
  - `Produit{id}` (`eTypeEvenement` 101/103/104): per-line state —
    `iQuantitePanier`, `rTotalAPayer`/`sTotalAPayer` (line total).
  - `Rayon{id}` (503): aisle rollup.
  - **`Panier{store}` (`eTypeEvenement` 1): cart grand total** —
    `iQuantitePanier` (total items), `rTotalAPayer`/`sTotalAPayer`,
    `sTotalHorsReductions`, `sMontantEconomies`, `fQuantiteDisponibleDepassee`.

  → Read the `Panier{store}` event for the authoritative cart total after any op.

## 3. get_cart

- `GET .../panier.aspx` (no `op`) → **404**. There is no plain cart page at that
  path.
- Instead, **every store page embeds the cart** in the "Panier" context:
  - `"lstProduits":[ {full product records} ]` — full `objElement`s with labels,
    `iQuantitePanier`, and per-line `rTotalAPayer`/`sTotalAPayer`.
  - `"lstProduitsLight":[ {"iIdProduit","iQtePanier","rTotalAPayer",...} ]` —
    a lightweight summary (no labels), immediately followed by the cart totals
    `"iQuantitePanier"`, `"sTotalHorsReductions"`, **`"sTotalAPayer"`** (grand total).
- Implementation (validated live): fetch `recherche.aspx?TexteRecherche=<no-match
  token>` so the page carries only cart records, extract the `lstProduits` array
  (exact key, so it doesn't match `lstProduitsLight`), map each record, and read
  the grand total from the `sTotalAPayer` next to `lstProduitsLight`.
- Note: cart line records use `iQuantitePanier` (full list) / `iQtePanier`
  (light list) — the client accepts either.

## 4. Store locator (find_stores) — `api-recherchemagasins.leclercdrive.fr`

A clean JSON REST API (separate from the ASP.NET store sites), validated live
2026-06-13. Behind DataDome like the rest — replay the Chrome cookie (the
`datadome` cookie on `.leclercdrive.fr` covers this subdomain). Base:
`https://api-recherchemagasins.leclercdrive.fr/API_RechercheMagasins/api/v1`.

Three chained calls:

1. `GET /autocomplete?search={postal|city}&provider=Woosmap`
   → `{ postalCodes: [ { id, postalCode, city } ], pointsLivraisonParNom, ... }`.
   Take `postalCodes[0].id` (an opaque Woosmap token).
2. `GET /autocomplete/coordinates?id={id}&provider=Woosmap`
   → `{ latitude, longitude }` for the place.
3. `GET /MapPoint/nearby?latitude={lat}&longitude={lng}&postalCode={cp}`
   → `{ points: [ store, ... ] }`, nearest first.

Each `point` carries: `name`, **`noPL`** (store id, zero-padded string),
**`noPR`** (retrieval point; == noPL for drives), `serviceType`
(⚠️ relays — "relais camion", "relais piéton" — share their drive's `noPL`,
seen live; `find_stores` shows them as `noPL-noPR` so each id is unique)
(`drive` / `relais` / `livraison`), `distance` (km), `postalCode`,
`coordinates {latitude, longitude}`, and **`urlSiteCourse` / `urlBase`** — the
store's shopping host (e.g. `fd8`/`fd9`/`fd14-courses.leclercdrive.fr`, **varies
per store**). The client maps these into the active `StoreSelection`
(see `src/store.ts`, `src/leclerc/locator.ts`).

⚠️ **Session is bound to one drive.** Shopping (search/cart) only works against
the drive the Chrome session is currently logged into. `set_store` to a store the
browser isn't on yields a "session expirée" page. Replaying Leclerc's
"switch drive" call to rebind the session server-side is an open item (would let
set_store switch to any drive) — see below.

## 5. Hosts and redirects (v0.4)

- **Generic hosts redirect.** The locator can report `fd1-courses` for a store
  served by `fd10-courses`; a navigation 302s there (slug added). An in-page
  fetch to fd1 is then cross-origin and fails with `TypeError: Failed to fetch`
  ([upstream #1](https://github.com/skunkobi/mcp-leclerc-drive/issues/1)). The
  client reads `location.href` after each navigation, sends page-relative URLs
  and persists the shard it landed on.
- **Idle redirect to fdN-secure.** After ~16 min without a call, the store host
  may answer with a redirect to its `fdN-secure` twin, which an in-page fetch
  cannot follow
  ([upstream #2](https://github.com/skunkobi/mcp-leclerc-drive/issues/2)). A
  top-level navigation follows it and restores the session: the client
  re-navigates and retries once.
- Hosts seen: `fdN-courses` (shopping), `fdN-secure` (session),
  `www.leclercdrive.fr` (home, locator page origin),
  `api-recherchemagasins.leclercdrive.fr` (locator API), `fdN-photos` (product
  images, loaded by the page itself, never fetched by the server). The server's
  allowlist is `src/hosts.ts`.

## Open items / to refine

- Confirm `objContexteProvenanceArticle` can be fully omitted on **add** (only
  verified omittable on remove).
- Find a clean read-only cart endpoint if one exists (avoid HTML scrape).
- DataDome cookie lifetime / refresh behaviour for long-lived sessions.
- **Reverse-engineer the "switch drive" call** so `set_store` can rebind the
  session to any drive server-side (today it must match the browser's drive).
- Checkout / slot-booking flow (out of scope).

## Seen live on 2026-11-11 (store 027411)

- **Zero-result search.** `recherche.aspx` with a query that matches nothing still carries six
  `sType: "Produit"` records, in a widget whose id contains `ucZeroResultat` (suggestions). A page
  with results has no `ucZeroResultat` at all. The client returns no product for such a page.
- **Login state.** Store pages carry `"fClientConnecte":true` when a customer is logged in.
- **The session's drive.** A navigation to `https://www.leclercdrive.fr/` lands on
  `/?mag=<noPL>-<noPR>&sRedirect=false` for a session that has a drive. The locator reads it from
  the page it already opens.
- **Offers.** `GET .../promotions.aspx` is a store page of about 24 MB with some 1 800 product
  records in the same `objElement` shape as a search (`iNbTotalProduits`, `iNbPage` are present but
  everything came in one page).
- **Aisles.** `GET .../rayon-<iIdRayon>-<slug>.aspx` returns the aisle's products in the same
  shape (156 for the one tried). The aisle menu itself is not in the page (client-side templates
  only), so there is no list of aisle ids to browse from; not exposed as a tool.
- No `iIdProduit` occurrence was unreadable on any of these pages.
- **Offer fields** (1 840 records of the offers page): `sTexteTooltipLot` (667 records) is the
  offer text for lots and immediate advantages, `sTexteLogoBRII` (357) the same text for the
  immediate ones; `sTexteLogoCoupon` was empty everywhere. `nrPVBRIIDeduit` (84, always with
  « Avantage immédiat de … ») is the unit price once the discount is taken off, lower than
  `nrPVUnitaireTTC` in every record and equal to `sPrixPromo`. The other records carry no offer
  text.
- **Origin.** `lstMentionsProduit` holds regulatory mentions of fresh products
  (`sLibelleMention` / `sLibelleValeur`): « Origine » (FRANCE, ESPAGNE…), « Variété », « Calibre »,
  « Catégorie », « Zone de pêche »… Only « Origine » is exposed.
