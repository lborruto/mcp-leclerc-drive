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
}

export interface CartEvent {
  eTypeEvenement?: number;
  sIdUnique?: string;
  objElement?: Record<string, unknown> & Partial<RawProduct>;
}
export function mapProduct(rp: RawProduct): Product {
  const label = decodeEntities(
    [rp.sLibelleLigne1, rp.sLibelleLigne2].filter(Boolean).join(" ").trim(),
  );
  const price = num(rp.nrPVUnitaireTTC) ?? parseEuro(rp.sPrixUnitaire) ?? 0;
  return {
    id: String(rp.iIdProduit),
    label: label || `Produit ${rp.iIdProduit}`,
    price,
    pricePerUnit: rp.sPrixParUniteDeMesure || undefined,
    available: (num(rp.iQteDisponible) ?? 0) > 0,
    imageUrl: rp.sUrlVignetteProduit || undefined,
  };
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
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}
