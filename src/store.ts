/**
 * Active store selection, with cross-session persistence.
 *
 * The store the tools operate on can be chosen at runtime (set_store) instead of
 * being fixed by env vars. The choice is persisted to
 * `~/.mcp-leclerc-drive/config.json` so it survives restarts. Resolution order:
 * persisted file → env/defaults (LeclercConfig).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { LeclercConfig } from "./config.js";
import { isStoreHost, isStoreId } from "./hosts.js";

export interface StoreSelection {
  /** Canonical store number (noPL), e.g. "053701". Used in URLs and payloads. */
  storeId: string;
  /** Retrieval point (noPR); equals storeId for drives, differs for piéton relays. */
  noPR: string;
  /** Backend host, e.g. "fd9-courses.leclercdrive.fr" (the fdN prefix varies). */
  host: string;
  /** Human-readable name, e.g. "Rezé Atout Sud" (optional, for display). */
  name?: string;
}

const CONFIG_FILE = join(homedir(), ".mcp-leclerc-drive", "config.json");

export class StoreState {
  private selection: StoreSelection;

  constructor(
    config: LeclercConfig,
    private readonly file: string = CONFIG_FILE,
  ) {
    const fallback: StoreSelection = {
      storeId: config.storeId,
      noPR: config.storeId,
      host: config.host,
    };
    this.selection = readPersisted(file) ?? fallback;
  }

  current(): StoreSelection {
    return this.selection;
  }

  set(selection: StoreSelection): void {
    if (!isValidSelection(selection)) {
      throw new Error(`Magasin invalide : ${selection.storeId} @ ${selection.host}.`);
    }
    this.selection = selection;
    writePersisted(this.file, selection);
  }

  /** Path of the persisted config file, for user-facing messages. */
  get configPath(): string {
    return this.file;
  }
}

function readPersisted(file: string): StoreSelection | null {
  try {
    if (!existsSync(file)) return null;
    const o = JSON.parse(readFileSync(file, "utf8"));
    if (o && typeof o.storeId === "string" && typeof o.host === "string") {
      const selection: StoreSelection = {
        storeId: o.storeId,
        noPR: typeof o.noPR === "string" ? o.noPR : o.storeId,
        host: o.host,
        name: typeof o.name === "string" ? o.name : undefined,
      };
      if (isValidSelection(selection)) return selection;
      console.error(`mcp-leclerc-drive: ${file} ignoré (magasin ou hôte invalide).`);
    }
  } catch {
    /* ignore corrupt/unreadable config — fall back to defaults */
  }
  return null;
}

function isValidSelection(s: StoreSelection): boolean {
  return isStoreId(s.storeId) && isStoreId(s.noPR) && isStoreHost(s.host);
}

function writePersisted(file: string, selection: StoreSelection): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(selection, null, 2) + "\n", "utf8");
}
