/**
 * The user's usual products: a short name they choose ("lait", "café du
 * matin") for a product id of a store, so a weekly shop does not search again
 * for what is bought every week. Kept in a local file only
 * (`~/.mcp-leclerc-drive/habituels.json`), per store: nothing is sent anywhere.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Usual {
  name: string;
  productId: string;
  /** The product's label when it was saved, if the server had seen it. */
  label?: string;
}

/** Most usual products per store: a household's list, not a catalogue. */
export const MAX_USUALS = 200;

const USUALS_FILE = join(homedir(), ".mcp-leclerc-drive", "habituels.json");

type FileShape = Record<string, Record<string, { productId: string; label?: string }>>;

/** "  Lait  Demi " → "lait demi": names are matched whatever their case and spacing. */
export function usualKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export class Usuals {
  constructor(private readonly file: string = USUALS_FILE) {}

  list(storeId: string): Usual[] {
    const store = this.read()[storeId] ?? {};
    return Object.entries(store)
      .map(([name, u]) => ({ name, productId: u.productId, label: u.label }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }

  /** Save or replace a name. Returns the product it replaced, if any. */
  save(storeId: string, name: string, productId: string, label?: string): Usual | undefined {
    const key = usualKey(name);
    if (!key) throw new Error("Donne un nom au produit habituel (ex. « lait »).");
    const all = this.read();
    const store = (all[storeId] ??= {});
    const previous = store[key];
    if (!previous && Object.keys(store).length >= MAX_USUALS) {
      throw new Error(`Déjà ${MAX_USUALS} produits habituels pour ce magasin : oublies-en avec forget_usual.`);
    }
    store[key] = label ? { productId, label } : { productId };
    this.write(all);
    return previous ? { name: key, productId: previous.productId, label: previous.label } : undefined;
  }

  /** Forget a name. Returns what it pointed to, or undefined if it was unknown. */
  forget(storeId: string, name: string): Usual | undefined {
    const key = usualKey(name);
    const all = this.read();
    const previous = all[storeId]?.[key];
    if (!previous) return undefined;
    delete all[storeId][key];
    if (Object.keys(all[storeId]).length === 0) delete all[storeId];
    this.write(all);
    return { name: key, productId: previous.productId, label: previous.label };
  }

  /** The file's valid entries; anything else in it (hand edits, corruption) is ignored. */
  private read(): FileShape {
    const out: FileShape = {};
    try {
      if (!existsSync(this.file)) return out;
      const raw: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
      for (const [storeId, entries] of Object.entries(raw)) {
        if (!/^\d{1,10}$/.test(storeId) || !entries || typeof entries !== "object") continue;
        for (const [name, u] of Object.entries(entries as Record<string, unknown>)) {
          const e = u as { productId?: unknown; label?: unknown };
          if (!e || typeof e.productId !== "string" || !/^\d{1,12}$/.test(e.productId)) continue;
          const key = usualKey(name);
          if (!key || key.length > 60) continue;
          (out[storeId] ??= {})[key] = {
            productId: e.productId,
            label: typeof e.label === "string" ? e.label.slice(0, 200) : undefined,
          };
        }
      }
    } catch {
      /* unreadable file: start from nothing rather than fail every tool */
    }
    return out;
  }

  private write(all: FileShape): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n", "utf8");
    renameSync(tmp, this.file);
  }
}
