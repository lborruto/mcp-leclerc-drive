/**
 * Plain-text rendering of tool results, in French like the site. Kept apart
 * from index.ts so it is unit-tested.
 */

import { FoundStore } from "./leclerc/locator.js";
import { AddManyResult, Cart, CartChange, Product } from "./types.js";

const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

export function formatProduct(p: Product): string {
  const bits = [
    p.label,
    `— ${euro(p.price)}`,
    p.pricePerUnit ? `[${p.pricePerUnit}]` : null,
    p.size ? `· ${p.size}` : null,
    p.offer ? `🏷️ ${p.offer}` : null,
    p.family ? `· ${p.family}` : null,
    p.rating ? `· ${p.rating.stars.toString().replace(".", ",")}/5 (${p.rating.reviews} avis)` : null,
    p.inCart ? `· ${p.inCart} au panier` : null,
    p.available ? null : "⚠️ indisponible",
    `id=${p.id}`,
  ].filter(Boolean);
  return bits.join(" ");
}

/** How search results are ordered: the site's order, cheapest first, or cheapest per kilo/litre first. */
export type SearchSort = "pertinence" | "prix" | "prix_unite";

const SORT_LABEL: Record<SearchSort, string> = {
  pertinence: "",
  prix: ", du moins cher au plus cher",
  prix_unite: ", du moins cher au plus cher au kilo/litre",
};

/** Stable sort; products without the sorted price (no per-unit price) go last. */
function sorted(products: Product[], sort: SearchSort): Product[] {
  if (sort === "pertinence") return products;
  const key = (p: Product) => (sort === "prix" ? p.price : p.pricePerUnitValue) ?? Infinity;
  return [...products].sort((a, b) => {
    const [ka, kb] = [key(a), key(b)];
    return ka === kb ? 0 : ka < kb ? -1 : 1;
  });
}

/**
 * Search results for the model: available products first, then in the asked
 * order (the site's by default), at most `limit`, with a count of what was
 * left out.
 */
export function formatSearch(
  query: string,
  products: Product[],
  opts: { limit: number; onlyAvailable: boolean; sort?: SearchSort },
): string {
  if (products.length === 0) return `Aucun produit trouvé pour « ${query} ».`;
  const pool = opts.onlyAvailable ? products.filter((p) => p.available) : products;
  if (pool.length === 0) return `Aucun produit disponible pour « ${query} » (${products.length} indisponible(s)).`;
  const sort = opts.sort ?? "pertinence";
  const inOrder = sorted(pool, sort);
  const ordered = [...inOrder.filter((p) => p.available), ...inOrder.filter((p) => !p.available)];
  const shown = ordered.slice(0, opts.limit);
  const head =
    shown.length < ordered.length
      ? `${ordered.length} produit(s) pour « ${query} »${SORT_LABEL[sort]}, les ${shown.length} premiers :`
      : `${ordered.length} produit(s) pour « ${query} »${SORT_LABEL[sort]} :`;
  const more = shown.length < ordered.length ? `\n… ${ordered.length - shown.length} autre(s) : précise la recherche ou augmente limit.` : "";
  return `${head}\n${shown.map(formatProduct).join("\n")}${more}`;
}

export function formatCart(cart: Cart): string {
  if (cart.items.length === 0) return `Panier vide (magasin ${cart.storeId}).`;
  const lines = cart.items.map(
    (it) => `• ${it.quantity}× ${it.product.label} — ${euro(it.lineTotal)} (id=${it.product.id})`,
  );
  return (
    `Panier (magasin ${cart.storeId}) — ${cart.items.length} produit(s), ${cart.itemCount} article(s) :\n` +
    lines.join("\n") +
    `\n\nTotal : ${euro(cart.total)}`
  );
}

/** One line for a cart change, plus the cart totals when Leclerc gave them. */
export function formatChange(verb: string, change: CartChange): string {
  const what = change.line
    ? `${change.line.product.label} (id=${change.productId}) : ${change.quantity} au panier, ${euro(change.line.lineTotal)}`
    : `produit ${change.productId} : ${change.quantity} au panier`;
  const out = [`${verb} — ${what}.`];
  if (change.limited) out.push("⚠️ Leclerc Drive en a gardé moins que demandé (stock ou limite par commande).");
  if (change.cartTotal !== undefined) {
    const count = change.cartItemCount !== undefined ? `${change.cartItemCount} article(s), ` : "";
    out.push(`Panier : ${count}${euro(change.cartTotal)}. Détail : get_cart.`);
  }
  return out.join("\n");
}

export function formatAddMany(r: AddManyResult): string {
  const ok = r.results.filter((x) => x.ok).length;
  const lines = r.results.map((x) => {
    if (!x.ok) return `✗ ${x.productId} ×${x.requested} — ${x.error}`;
    const c = x.change!;
    const label = c.line?.product.label ?? `produit ${x.productId}`;
    const limited = c.limited ? " ⚠️ moins que demandé" : "";
    return `✓ ${label} (id=${x.productId}) +${x.requested} → ${c.quantity} au panier${limited}`;
  });
  const cart = r.cart ? formatCart(r.cart) : `Panier final illisible : ${r.cartError}`;
  return `${ok}/${r.results.length} ajout(s) réussi(s) :\n${lines.join("\n")}\n\n${cart}`;
}

export function formatStores(query: string, stores: FoundStore[]): string {
  const lines = stores.map((s) => {
    const dist = s.distanceKm !== undefined ? ` ${s.distanceKm.toFixed(1)} km` : "";
    return `• ${s.name} — ${s.serviceType}${dist} (id=${s.key})`;
  });
  return (
    `Drives autour de « ${query} » :\n${lines.join("\n")}\n\n` +
    `Pour en choisir un : set_store avec son id. Les courses fonctionnent sur les « drive ».`
  );
}
