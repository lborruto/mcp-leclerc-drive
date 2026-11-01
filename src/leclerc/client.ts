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
import { isStoreHost } from "../hosts.js";
import { StoreState } from "../store.js";
import { Cart, CartItem, Product } from "../types.js";
import {
  assertStorePage,
  CartEvent,
  extractArrayNamed,
  extractCartTotal,
  mapProduct,
  num,
  parseEuro,
  RawProduct,
  round2,
  scanProductRecords,
} from "./parse.js";
import { PageHttp } from "./http.js";

/** Cart mutation discriminator (see capture doc §2). */
const ACTION_ADD = 1; // add / increase to target qty
const ACTION_SUB = 2; // decrease / remove (qty 0)


/** Query token that returns no search results, so a fetched page carries only cart data. */
const NO_MATCH_QUERY = "zzzznomatchzzz";

export class LeclercClient {
  constructor(
    private readonly http: PageHttp,
    private readonly store: StoreState,
  ) {}

  /**
   * The store page every search/cart fetch runs from. The request goes to the
   * selected host, which may redirect to the store's real shard; any page of
   * this store on a store host will do, whatever the cosmetic slug.
   */
  private storePage(): PageTarget {
    const s = this.store.current();
    const prefix = `/magasin-${s.storeId}-`;
    return {
      url: `https://${s.host}/${storePath(s.storeId, s.noPR)}/recherche.aspx?TexteRecherche=`,
      accept: (landed) => isStoreHost(landed.host) && landed.pathname.startsWith(prefix),
      mismatchHint:
        "Ouvre la fenêtre Chrome du serveur, vérifie que tu es connecté à Leclerc Drive sur ce " +
        "magasin, puis réessaie.",
    };
  }

  /**
   * Remember the host the store page really lives on, so later sessions go
   * straight there instead of through a redirect (issue #1).
   */
  private adoptLandedHost(pageUrl: string): void {
    const host = new URL(pageUrl).host;
    const s = this.store.current();
    if (host === s.host || !isStoreHost(host)) return;
    console.error(`mcp-leclerc-drive: magasin ${s.storeId} servi par ${host} (au lieu de ${s.host}), mémorisé.`);
    this.store.set({ ...s, host });
  }

  /** Every store request: throttled, retried, run from the store page (see http.ts). */
  private send(
    method: "GET" | "POST",
    url: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<PageResponse> {
    return this.http.request(() => this.storePage(), url, {
      method,
      headers,
      body,
      onResponse: (res) => this.adoptLandedHost(res.pageUrl),
      blockedMessage: (status) =>
        `Bloqué par Leclerc Drive (HTTP ${status}) après plusieurs tentatives. Vérifie que tu ` +
        `es connecté à Leclerc Drive dans la fenêtre Chrome ouverte par le serveur, puis réessaie.`,
    });
  }

  // URLs are relative to the store page: they follow the shard it landed on.

  private cartUrl(): string {
    const s = this.store.current();
    return `/${storePath(s.storeId, s.noPR)}/panier.aspx?op=1`;
  }

  private searchUrl(query: string): string {
    const s = this.store.current();
    return `/${storePath(s.storeId, s.noPR)}/recherche.aspx?TexteRecherche=${encodeURIComponent(query)}`;
  }

  // ---- Search ------------------------------------------------------------

  async searchProducts(query: string): Promise<Product[]> {
    const res = await this.send("GET", this.searchUrl(query), { Accept: "text/html" });
    if (!res.ok) throw new Error(`Search HTTP ${res.status} (${res.statusText})`);
    const html = await res.text();
    assertStorePage(html);

    // The search page embeds product data inside `initOptions(...)` widget
    // calls as `{objContenu:{lstElements:[{objElement:{...iIdProduit...}}]}}`.
    // Each `objElement` is pure JSON, so we scan the page for every product
    // record (smallest object enclosing an `iIdProduit`) and map it.
    const seen = new Set<string>();
    const products: Product[] = [];
    for (const rp of scanProductRecords(html)) {
      if (rp.sType && rp.sType !== "Produit") continue;
      const id = String(rp.iIdProduit);
      if (seen.has(id)) continue;
      seen.add(id);
      products.push(mapProduct(rp));
    }
    return products;
  }

  // ---- Cart mutations ----------------------------------------------------

  private async mutate(
    productId: string,
    quantity: number,
    action: number,
  ): Promise<Cart> {
    const payload = {
      eTypeAction: action,
      iIdProduit: String(productId),
      iQuantite: quantity,
      sNoPointLivraison: this.store.current().storeId,
    };
    const body = "d=" + encodeURIComponent(JSON.stringify(payload));
    const res = await this.send(
      "POST",
      this.cartUrl(),
      {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*; q=0.01",
      },
      body,
    );
    if (!res.ok) throw new Error(`Cart HTTP ${res.status} (${res.statusText})`);
    const text = await res.text();
    let events: CartEvent[];
    try {
      events = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Unexpected cart response (not JSON): ${(err as Error).message}. ` +
          `First chars: ${text.slice(0, 120)}`,
      );
    }
    return this.cartFromEvents(events);
  }

  async addToCart(productId: string, quantity: number): Promise<Cart> {
    return this.mutate(productId, quantity, ACTION_ADD);
  }

  async removeFromCart(productId: string): Promise<Cart> {
    return this.mutate(productId, 0, ACTION_SUB);
  }

  async updateQuantity(productId: string, quantity: number): Promise<Cart> {
    if (quantity <= 0) return this.removeFromCart(productId);
    // Direction matters: action 1 increases, action 2 decreases. We read the
    // current quantity to choose, since iQuantite is an absolute target.
    const current = await this.currentQuantity(productId);
    const action = quantity >= current ? ACTION_ADD : ACTION_SUB;
    return this.mutate(productId, quantity, action);
  }

  private async currentQuantity(productId: string): Promise<number> {
    const cart = await this.getCart();
    const line = cart.items.find((i) => i.product.id === String(productId));
    return line?.quantity ?? 0;
  }

  // ---- Cart read ---------------------------------------------------------

  async getCart(): Promise<Cart> {
    // Every store page embeds the cart in the "Panier" context as a full
    // `lstProduits` array (product records with labels + per-line totals) plus a
    // `lstProduitsLight` summary and a `sTotalAPayer` grand total. We fetch a
    // no-match search page so the only product records present are the cart's,
    // then extract and map the `lstProduits` array.
    const res = await this.send("GET", this.searchUrl(NO_MATCH_QUERY), { Accept: "text/html" });
    if (!res.ok) throw new Error(`Cart read HTTP ${res.status} (${res.statusText})`);
    const html = await res.text();
    assertStorePage(html);

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
        const lineTotal =
          num(rp.rTotalAPayer) ?? parseEuro(rp.sTotalAPayer) ?? round2(product.price * qty);
        items.push({ product, quantity: qty, lineTotal });
      }
    }
    const grandTotal =
      parseEuro(extractCartTotal(html)) ?? round2(items.reduce((s, i) => s + i.lineTotal, 0));
    return {
      items,
      itemCount: items.reduce((s, i) => s + i.quantity, 0),
      total: round2(grandTotal),
      storeId: this.store.current().storeId,
    };
  }

  /** Build a Cart from a mutation event array (see capture doc §2). */
  private cartFromEvents(events: CartEvent[]): Cart {
    const items: CartItem[] = [];
    let total = 0;
    let itemCount = 0;
    for (const e of events) {
      const id = String(e.sIdUnique ?? "");
      const el = e.objElement ?? {};
      if (id.startsWith("Panier")) {
        total = num(el.rTotalAPayer) ?? parseEuro(el.sTotalAPayer) ?? total;
        itemCount = num(el.iQuantitePanier) ?? itemCount;
      } else if (id.startsWith("Produit") && el.sType === "Produit") {
        const qty = num(el.iQuantitePanier) ?? 0;
        if (qty > 0) {
          const product = mapProduct(el as RawProduct);
          const lineTotal =
            num(el.rTotalAPayer) ?? parseEuro(el.sTotalAPayer) ?? round2(product.price * qty);
          items.push({ product, quantity: qty, lineTotal });
        }
      }
    }
    return { items, itemCount, total: round2(total), storeId: this.store.current().storeId };
  }
}
