/**
 * Leclerc Drive backend client.
 *
 * Endpoints reverse-engineered and validated live against store 053701 on
 * 2026-06-13 — see docs/api-capture.md for the full capture.
 *
 * Confidence levels:
 *  - Cart mutations (add / update / remove) hit a clean JSON endpoint and were
 *    replayed successfully end-to-end. High confidence.
 *  - search() and getCart() extract data embedded in the page as JS globals
 *    (`_objDataSourceGroupeTrieFiltre`, `objContenuPanier`). The field schema is
 *    validated; the exact extraction from live HTML is marked `// VALIDATE:` and
 *    should be sanity-checked on first real run with a session cookie.
 */

import { PageResponse, PageTarget } from "../browser.js";
import { storePath } from "../config.js";
import { BlockingError, isBlocking, SiteChangedError } from "../errors.js";
import { isStoreHost } from "../hosts.js";
import { StoreSelection, StoreState } from "../store.js";
import { AddManyItemResult, AddManyResult, Cart, CartChange, CartItem, Product } from "../types.js";
import {
  assertStorePage,
  CartEvent,
  extractArrayNamed,
  extractCartTotal,
  isZeroResultPage,
  loggedInFlag,
  mapProduct,
  num,
  parseEuro,
  RawProduct,
  round2,
  scanProductRecords,
  scanProducts,
  withoutCartContext,
} from "./parse.js";
import { PageHttp } from "./http.js";

/** Cart mutation discriminator (see capture doc §2). */
const ACTION_ADD = 1; // add / increase to target qty
const ACTION_SUB = 2; // decrease / remove (qty 0)


const OFFERS_TTL_MS = 10 * 60 * 1000;

/** Query token that returns no search results, so a fetched page carries only cart data. */
const NO_MATCH_QUERY = "zzzznomatchzzz";

export class LeclercClient {
  constructor(
    private readonly http: PageHttp,
    private readonly store: StoreState,
  ) {}

  /** Labels of the products seen this session (searches, cart), by id: no request needed to name one. */
  private readonly labels = new Map<string, string>();

  private remember(p: Product): void {
    if (this.labels.size >= 5000) this.labels.clear();
    this.labels.set(p.id, p.label);
  }

  /** The label of a product seen in a search or in the cart since the server started. */
  labelOf(productId: string): string | undefined {
    return this.labels.get(productId);
  }

  /**
   * Whether the last store page read said a customer is logged in. False means
   * the cart being filled is a visitor's, not the user's account.
   */
  loggedIn: boolean | undefined;

  /** Every store page read goes through here: block pages refused, login state noted. */
  private readStorePage(html: string): void {
    assertStorePage(html);
    this.loggedIn = loggedInFlag(html) ?? this.loggedIn;
  }

  /** The offers page is heavy (about 24 MB): kept a few minutes per store. */
  private offersCache: { key: string; at: number; products: Product[] } | undefined;

  /** Cart operations, one at a time: a read-then-write must not interleave with another. */
  private cartQueue: Promise<unknown> = Promise.resolve();

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.cartQueue.then(fn);
    this.cartQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * The store page every search/cart fetch runs from. The request goes to the
   * selected host, which may redirect to the store's real shard; any page of
   * this store on a store host will do, whatever the cosmetic slug.
   */
  private storePage(sel: StoreSelection): PageTarget {
    const prefix = `/magasin-${sel.storeId}-`;
    return {
      url: `https://${sel.host}/${storePath(sel.storeId, sel.noPR)}/recherche.aspx?TexteRecherche=`,
      accept: (landed) => isStoreHost(landed.host) && landed.pathname.startsWith(prefix),
      mismatchHint:
        "Ouvre la fenêtre Chrome du serveur, vérifie que tu es connecté à Leclerc Drive sur ce " +
        "magasin, puis réessaie.",
    };
  }

  /**
   * Remember the host the store page really lives on, so later sessions go
   * straight there instead of through a redirect (issue #1). Only if the
   * selection is still the store this request was for.
   */
  private adoptLandedHost(sel: StoreSelection, pageUrl: string): void {
    const host = new URL(pageUrl).host;
    const cur = this.store.current();
    if (cur.storeId !== sel.storeId || cur.noPR !== sel.noPR) return;
    if (host === cur.host || !isStoreHost(host)) return;
    console.error(`mcp-leclerc-drive: magasin ${cur.storeId} servi par ${host} (au lieu de ${cur.host}), mémorisé.`);
    this.store.set({ ...cur, host });
  }

  /**
   * Every store request: throttled, retried, run from the page of the store
   * `sel` names (see http.ts). One operation takes one snapshot of the
   * selection, so a set_store in the middle cannot mix two stores.
   */
  private send(
    sel: StoreSelection,
    method: "GET" | "POST",
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<PageResponse> {
    return this.http.request(() => this.storePage(sel), url, {
      method,
      headers,
      body,
      onResponse: (res) => this.adoptLandedHost(sel, res.pageUrl),
      blockedMessage: (status) =>
        `Bloqué par Leclerc Drive (HTTP ${status}) après plusieurs tentatives. Vérifie que tu ` +
        `es connecté à Leclerc Drive dans la fenêtre Chrome ouverte par le serveur, puis réessaie.`,
    });
  }

  // URLs are relative to the store page: they follow the shard it landed on.

  private cartUrl(sel: StoreSelection): string {
    return `/${storePath(sel.storeId, sel.noPR)}/panier.aspx?op=1`;
  }

  private searchUrl(sel: StoreSelection, query: string): string {
    return `/${storePath(sel.storeId, sel.noPR)}/recherche.aspx?TexteRecherche=${encodeURIComponent(query)}`;
  }

  // ---- Search ------------------------------------------------------------

  async searchProducts(query: string): Promise<Product[]> {
    const sel = this.store.current();
    const res = await this.send(sel, "GET", this.searchUrl(sel, query), { Accept: "text/html" });
    if (!res.ok) throw new Error(`Search HTTP ${res.status} (${res.statusText})`);
    const html = await res.text();
    this.readStorePage(html);
    if (isZeroResultPage(html)) return [];
    return this.pageProducts(html, "sa page de recherche");
  }

  /**
   * The products currently on offer in the store, from its promotions page
   * (one heavy request, kept 10 minutes).
   */
  async offers(): Promise<Product[]> {
    const sel = this.store.current();
    const key = `${sel.storeId}-${sel.noPR}`;
    const cached = this.offersCache;
    if (cached && cached.key === key && Date.now() - cached.at < OFFERS_TTL_MS) return cached.products;
    const res = await this.send(sel, "GET", `/${storePath(sel.storeId, sel.noPR)}/promotions.aspx`, {
      Accept: "text/html",
    });
    if (!res.ok) throw new Error(`Promotions HTTP ${res.status} (${res.statusText})`);
    const html = await res.text();
    this.readStorePage(html);
    const products = this.pageProducts(html, "sa page de promotions");
    this.offersCache = { key, at: Date.now(), products };
    return products;
  }

  /** The product records of a page (search, offers), without the cart's. */
  private pageProducts(html: string, what: string): Product[] {
    // The search page embeds product data inside `initOptions(...)` widget
    // calls as `{objContenu:{lstElements:[{objElement:{...iIdProduit...}}]}}`.
    // Each `objElement` is pure JSON, so we scan the page for every product
    // record (smallest object enclosing an `iIdProduit`) and map it. The cart
    // context every page carries is cut out first: cart lines are not results.
    const seen = new Set<string>();
    const products: Product[] = [];
    const { records, unreadable } = scanProducts(withoutCartContext(html));
    for (const rp of records) {
      if (rp.sType !== "Produit") continue;
      const id = String(rp.iIdProduit);
      if (seen.has(id)) continue;
      seen.add(id);
      products.push(mapProduct(rp));
    }
    // Product records that cannot be read, or that all come out without a
    // price: the page changed. An empty list would read as "no such product".
    if (
      (products.length === 0 && unreadable > 0) ||
      (products.length > 0 && products.every((p) => p.price === 0))
    ) {
      throw new SiteChangedError(what);
    }
    for (const p of products) this.remember(p);
    return products;
  }

  // ---- Cart mutations ----------------------------------------------------

  /**
   * Set a cart line to an absolute quantity (the backend's only mode, see
   * capture doc §2) and report what Leclerc Drive says the line and the cart
   * now hold.
   */
  private async mutate(
    sel: StoreSelection,
    productId: string,
    target: number,
    action: number,
  ): Promise<CartChange> {
    const payload = {
      eTypeAction: action,
      iIdProduit: String(productId),
      iQuantite: target,
      sNoPointLivraison: sel.storeId,
    };
    const body = "d=" + encodeURIComponent(JSON.stringify(payload));
    const res = await this.send(
      sel,
      "POST",
      this.cartUrl(sel),
      {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
      body,
    );
    if (!res.ok) throw new Error(`Panier : HTTP ${res.status} (${res.statusText})`);
    const text = await res.text();
    let events: CartEvent[];
    try {
      events = JSON.parse(text);
    } catch {
      // An HTML page instead of the JSON events: DataDome's interstitial or the
      // expired-session page. Every following change would get it too.
      if (/^\s*</.test(text)) assertStorePage(text);
      throw new BlockingError("Réponse inattendue de Leclerc Drive au changement du panier (pas du JSON).");
    }
    if (!Array.isArray(events)) {
      throw new Error("Réponse inattendue de Leclerc Drive au changement du panier.");
    }
    return changeFromEvents(events, String(productId), target);
  }

  /** Add `quantity` units on top of what the cart already holds. */
  addToCart(productId: string, quantity: number): Promise<CartChange> {
    return this.exclusive(async () => {
      const sel = this.store.current();
      const current = await this.currentQuantity(sel, productId);
      return this.mutate(sel, productId, current + quantity, ACTION_ADD);
    });
  }

  removeFromCart(productId: string): Promise<CartChange> {
    return this.exclusive(() => this.mutate(this.store.current(), productId, 0, ACTION_SUB));
  }

  /** Set the line to exactly `quantity` (0 removes it). */
  updateQuantity(productId: string, quantity: number): Promise<CartChange> {
    if (quantity <= 0) return this.removeFromCart(productId);
    return this.exclusive(async () => {
      const sel = this.store.current();
      // Direction matters: action 1 increases, action 2 decreases. We read the
      // current quantity to choose, since iQuantite is an absolute target.
      const current = await this.currentQuantity(sel, productId);
      const action = quantity >= current ? ACTION_ADD : ACTION_SUB;
      return this.mutate(sel, productId, quantity, action);
    });
  }

  /**
   * Add several products, one after another through the shared throttle. One
   * item failing does not stop the others; a block (DataDome, expired session,
   * Chrome lost) does, since every following request would fail the same way
   * and only make the block worse. The cart is read once before and once after.
   */
  addMany(items: Array<{ productId: string; quantity: number }>): Promise<AddManyResult> {
    return this.exclusive(async () => {
      const sel = this.store.current();
      const before = await this.readCart(sel);
      const inCart = new Map(before.items.map((i) => [i.product.id, i.quantity]));
      const results: AddManyItemResult[] = [];
      let stopped = false;
      for (const { productId, quantity } of items) {
        if (stopped) {
          results.push({ productId, requested: quantity, ok: false, error: "non tenté : arrêt après un blocage" });
          continue;
        }
        try {
          const change = await this.mutate(sel, productId, (inCart.get(productId) ?? 0) + quantity, ACTION_ADD);
          inCart.set(productId, change.quantity);
          results.push({ productId, requested: quantity, ok: true, change });
        } catch (err) {
          results.push({ productId, requested: quantity, ok: false, error: errorMessage(err) });
          if (isBlocking(err)) stopped = true;
        }
      }
      let cart: Cart | undefined;
      let cartError: string | undefined;
      try {
        cart = await this.readCart(sel);
      } catch (err) {
        cartError = errorMessage(err);
      }
      return { results, cart, cartError };
    });
  }

  private async currentQuantity(sel: StoreSelection, productId: string): Promise<number> {
    const cart = await this.readCart(sel);
    const line = cart.items.find((i) => i.product.id === String(productId));
    return line?.quantity ?? 0;
  }

  // ---- Cart read ---------------------------------------------------------

  getCart(): Promise<Cart> {
    return this.readCart(this.store.current());
  }

  private async readCart(sel: StoreSelection): Promise<Cart> {
    // Every store page embeds the cart in the "Panier" context as a full
    // `lstProduits` array (product records with labels + per-line totals) plus a
    // `lstProduitsLight` summary and a `sTotalAPayer` grand total. We fetch a
    // no-match search page so the only product records present are the cart's,
    // then extract and map the `lstProduits` array.
    const res = await this.send(sel, "GET", this.searchUrl(sel, NO_MATCH_QUERY), { Accept: "text/html" });
    if (!res.ok) throw new Error(`Cart read HTTP ${res.status} (${res.statusText})`);
    const html = await res.text();
    this.readStorePage(html);

    const arr = extractArrayNamed(html, "lstProduits");
    const items: CartItem[] = [];
    if (arr) {
      const seen = new Set<string>();
      for (const rp of scanProductRecords(arr)) {
        const qty = num(rp.iQuantitePanier) ?? num(rp.iQtePanier) ?? 0;
        if (qty <= 0) continue;
        const id = String(rp.iIdProduit);
        if (seen.has(id)) continue;
        seen.add(id);
        const product = mapProduct(rp);
        this.remember(product);
        const lineTotal =
          num(rp.rTotalAPayer) ?? parseEuro(rp.sTotalAPayer) ?? round2(product.price * qty);
        items.push({ product, quantity: qty, lineTotal });
      }
    }
    // The light summary lists lines the full list did not give: the format changed.
    const light = extractArrayNamed(html, "lstProduitsLight");
    if (items.length === 0 && light && scanProductRecords(light).some((r) => (num(r.iQtePanier) ?? 0) > 0)) {
      throw new SiteChangedError("le panier de ses pages");
    }
    const grandTotal =
      parseEuro(extractCartTotal(html)) ?? round2(items.reduce((s, i) => s + i.lineTotal, 0));
    return {
      items,
      itemCount: items.reduce((s, i) => s + i.quantity, 0),
      total: round2(grandTotal),
      storeId: sel.storeId,
    };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Read a cart mutation's event array (capture doc §2): the changed product's
 * line (`Produit…` event) and the cart totals (`Panier…` event).
 */
export function changeFromEvents(events: CartEvent[], productId: string, target: number): CartChange {
  let line: CartItem | undefined;
  let lineQuantity: number | undefined;
  let total: number | undefined;
  let itemCount: number | undefined;
  let limited = false;
  for (const e of events) {
    const id = String(e.sIdUnique ?? "");
    const el = e.objElement ?? {};
    if (id.startsWith("Panier")) {
      total = num(el.rTotalAPayer) ?? parseEuro(el.sTotalAPayer) ?? total;
      itemCount = num(el.iQuantitePanier) ?? itemCount;
      if (el.fQuantiteDisponibleDepassee === true) limited = true;
    } else if (id === `Produit${productId}` || (id.startsWith("Produit") && String(el.iIdProduit) === productId)) {
      lineQuantity = num(el.iQuantitePanier) ?? 0;
      if (lineQuantity > 0) {
        const product = mapProduct(el as RawProduct);
        const lineTotal =
          num(el.rTotalAPayer) ?? parseEuro(el.sTotalAPayer) ?? round2(product.price * lineQuantity);
        line = { product, quantity: lineQuantity, lineTotal };
      }
    }
  }
  if (lineQuantity === undefined && target > 0) {
    throw new Error(
      `Leclerc Drive n'a pas confirmé le produit ${productId} (identifiant inconnu dans ce magasin ?).`,
    );
  }
  const quantity = lineQuantity ?? 0;
  if (target > 0 && quantity === 0) {
    // Seen live: an unknown id comes back as a line at 0, not as an error.
    throw new Error(`Leclerc Drive n'a pas ajouté le produit ${productId} (identifiant inconnu ou indisponible).`);
  }
  return {
    productId,
    quantity,
    line,
    limited: limited || quantity < target,
    cartTotal: total === undefined ? undefined : round2(total),
    cartItemCount: itemCount,
  };
}
