/**
 * Pure parsing helpers for Leclerc Drive pages and cart responses: no I/O, so
 * they are unit-tested against synthetic fixtures (test/parse.test.ts). See
 * docs/api-capture.md for the shapes.
 */

import { BlockingError } from "../errors.js";
import { Product } from "../types.js";

/**
 * Marker embedded in the chrome of every real Leclerc store page (the cart
 * summary). The two non-store responses we can get back with HTTP 200 — DataDome's
 * soft JS-challenge interstitial and the "session expirée" page — don't contain it.
 * Note: the `x-datadome: protected` header and the `js.datadome.co` bootstrap are
 * present on legitimate pages too, so they cannot be used to detect a block.
 */
const STORE_PAGE_MARKER = "lstProduitsLight";

/**
 * Guard against silently treating a block page as "no results". A real store page
 * always carries STORE_PAGE_MARKER; if it's missing, the response is a DataDome
 * interstitial or an expired session — surface that with an actionable message
 * instead of returning an empty list.
 */
export function assertStorePage(html: string): void {
  if (html.includes(STORE_PAGE_MARKER)) return;
  const expired = /session a expir|sessionexpiree/i.test(html);
  throw new BlockingError(
    expired
      ? "Session Leclerc Drive expirée. Ouvre Leclerc Drive dans Chrome et reconnecte-toi, puis réessaie."
      : "Bloqué par Leclerc Drive (challenge DataDome). Ouvre Leclerc Drive dans Chrome et " +
        "recharge le magasin une fois pour rafraîchir la session, puis réessaie.",
  );
}

export interface RawProduct {
  iIdProduit: number | string;
  sLibelleLigne1?: string;
  sLibelleLigne2?: string;
  nrPVUnitaireTTC?: number;
  sPrixUnitaire?: string;
  sPrixPromo?: string;
  nrPVParUniteDeMesureTTC?: number;
  sPrixParUniteDeMesure?: string;
  iQteDisponible?: number;
  iQuantitePanier?: number;
  iQtePanier?: number;
  rTotalAPayer?: number;
  sTotalAPayer?: string;
  sUrlVignetteProduit?: string;
  sType?: string;
  /** Instant-discount text, e.g. "Bénéficiez de 0.40 € de remise immédiate." */
  sTexteLogoCoupon?: string;
  /** Link to the product's family page: /magasin-…/rayon-<iIdFamille>-<Family-Name>.aspx */
  sUrlVoirRayon?: string;
  iIdFamille?: number;
  /** Total pack size and its unit ("kg", "l", "p" for pieces). */
  nrContenanceTotale?: number;
  sUniteMesureTotale?: string;
  objAvisClient?: { Note?: { Valeur?: number }; NbAvis?: number };
}

export interface CartEvent {
  eTypeEvenement?: number;
  sIdUnique?: string;
  objElement?: Record<string, unknown> & Partial<RawProduct>;
}
/**
 * Map a raw `objElement` record to a Product. Only fields the site really
 * sends are exposed (inspected live 2026-11-01, see docs/api-capture.md §1);
 * nothing is guessed: no brand or origin field exists, so none is given.
 */
export function mapProduct(rp: RawProduct): Product {
  const label = decodeEntities(
    [rp.sLibelleLigne1, rp.sLibelleLigne2].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(),
  );
  const price = num(rp.nrPVUnitaireTTC) ?? parseEuro(rp.sPrixUnitaire) ?? 0;
  const offer = rp.sTexteLogoCoupon?.trim();
  const reviews = num(rp.objAvisClient?.NbAvis);
  const stars = num(rp.objAvisClient?.Note?.Valeur);
  const inCart = num(rp.iQuantitePanier) ?? num(rp.iQtePanier);
  return {
    id: String(rp.iIdProduit),
    label: label || `Produit ${rp.iIdProduit}`,
    price,
    offer: offer ? decodeEntities(offer) : undefined,
    pricePerUnit: rp.sPrixParUniteDeMesure || undefined,
    pricePerUnitValue: positive(num(rp.nrPVParUniteDeMesureTTC)),
    size: packSize(rp.nrContenanceTotale, rp.sUniteMesureTotale),
    family: familyName(rp.sUrlVoirRayon),
    rating: stars !== undefined && reviews ? { stars, reviews } : undefined,
    available: (num(rp.iQteDisponible) ?? 0) > 0,
    inCart: inCart && inCart > 0 ? inCart : undefined,
    imageUrl: rp.sUrlVignetteProduit || undefined,
  };
}

function positive(n: number | undefined): number | undefined {
  return n !== undefined && n > 0 ? n : undefined;
}

/** "0,6 kg", "6 l", "4 pièces" from the total pack size. */
function packSize(total: unknown, unit: unknown): string | undefined {
  const n = num(total);
  if (n === undefined || n <= 0 || typeof unit !== "string" || !unit.trim()) return undefined;
  const u = unit.trim().toLowerCase();
  const value = String(n).replace(".", ",");
  if (u === "p") return `${value} pièce${n > 1 ? "s" : ""}`;
  return `${value} ${u}`;
}

/**
 * The product family's name, from the slug of its "Voir le rayon" link
 * (rayon-319801-Legumes-et-Poelees.aspx → "Legumes et Poelees"). The slug has
 * no accents; it is the only place the site names the family in a record.
 */
function familyName(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const m = url.match(/\/rayon-\d+-([A-Za-z0-9-]+)\.aspx(?:[?#]|$)/);
  const name = m?.[1].replace(/-+/g, " ").trim();
  return name || undefined;
}

/**
 * Remove the cart context from a page (`lstProduits` and `lstProduitsLight`
 * arrays, present on every store page): what is left are the page's own
 * product records, e.g. the search results.
 */
export function withoutCartContext(html: string): string {
  let out = html;
  for (const name of ["lstProduits", "lstProduitsLight"]) {
    for (;;) {
      const arr = extractArrayNamed(out, name);
      if (!arr || arr === "[]") break;
      const at = out.indexOf(`"${name}":${arr}`);
      out = out.slice(0, at) + `"${name}":[]` + out.slice(at + name.length + 3 + arr.length);
    }
  }
  return out;
}

/**
 * Extract the balanced array literal that follows a `"name":[` key in an
 * HTML/JS blob (exact key match, so `lstProduits` does not match
 * `lstProduitsLight`). Returns the `[...]` substring, or null.
 */
export function extractArrayNamed(html: string, name: string): string | null {
  const marker = `"${name}":[`;
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = at + marker.length - 1; // position of '['
  let depth = 0;
  let inStr: string | null = null;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (c === "\\") j++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return html.slice(start, j + 1);
    }
  }
  return null;
}

/** Read the cart grand total string (e.g. "18,18 €") from the Panier context. */
export function extractCartTotal(html: string): string | undefined {
  const anchor = html.indexOf("lstProduitsLight");
  const scope = anchor >= 0 ? html.slice(anchor, anchor + 1500) : html;
  const m = scope.match(/"sTotalAPayer":"([^"]+)"/);
  return m?.[1];
}

/**
 * Tolerant extraction of product records from a JS literal that may contain
 * non-JSON members (functions). Finds each `"iIdProduit"` occurrence and parses
 * the smallest enclosing `{...}` object, skipping any that fail to parse.
 */
export function scanProductRecords(raw: string): RawProduct[] {
  const out: RawProduct[] = [];
  const re = /"iIdProduit"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const obj = smallestEnclosingObject(raw, m.index);
    if (obj) {
      try {
        out.push(JSON.parse(obj) as RawProduct);
      } catch {
        /* skip records with function members etc. */
      }
    }
  }
  return out;
}

function smallestEnclosingObject(raw: string, at: number): string | null {
  // walk backwards to the opening brace of this object
  let start = -1;
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = raw[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return null;
  // forward to the matching close, respecting strings
  depth = 0;
  let inStr: string | null = null;
  for (let j = start; j < raw.length; j++) {
    const c = raw[j];
    if (inStr) {
      if (c === "\\") j++;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") inStr = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, j + 1);
    }
  }
  return null;
}

export function num(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/** Parse a French-formatted euro string like "11,88 €" → 11.88. */
export function parseEuro(v: unknown): number | undefined {
  if (typeof v !== "string") return undefined;
  const cleaned = v.replace(/[^\d,.-]/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isNaN(n) ? undefined : n;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Decode the HTML entities that appear in product labels (numeric + a few named). */
export function decodeEntities(s: string): string {
  // One pass, so a decoded "&" never starts another entity ("&#38;lt;" stays "&lt;"),
  // and an out-of-range code point is left as written instead of throwing.
  return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
