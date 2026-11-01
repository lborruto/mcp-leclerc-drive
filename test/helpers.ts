import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LeclercConfig } from "../src/config.js";
import { StoreState } from "../src/store.js";

/** A config with no throttling delays, for tests. */
export function testConfig(overrides: Partial<LeclercConfig> = {}): LeclercConfig {
  return {
    storeId: "053701",
    host: "fd9-courses.leclercdrive.fr",
    chromePath: undefined,
    chromeProfileDir: mkdtempSync(join(tmpdir(), "leclerc-test-profile-")),
    chromePort: 0,
    headless: true,
    minIntervalMs: 0,
    jitterMs: 0,
    maxRetries: 2,
    backoffBaseMs: 0,
    ...overrides,
  };
}

/** A StoreState persisted to a throwaway file instead of the user's home. */
export function tempStore(config: LeclercConfig): { store: StoreState; file: string } {
  const file = join(mkdtempSync(join(tmpdir(), "leclerc-test-store-")), "config.json");
  return { store: new StoreState(config, file), file };
}

/** A minimal real-looking store page (the cart context marks it as a store page). */
export function storePage(products: Array<Record<string, unknown>> = [], cart: Array<Record<string, unknown>> = []): string {
  const elements = products.map((p) => `{"objElement":${JSON.stringify({ sType: "Produit", ...p })}}`).join(",");
  const lines = cart.map((p) => JSON.stringify({ sType: "Produit", ...p })).join(",");
  const total = cart.reduce((s, p) => s + Number(p.rTotalAPayer ?? 0), 0).toFixed(2).replace(".", ",");
  return (
    `<script>Utilitaires.widget.initOptions('x', {"objContenu":{"lstElements":[${elements}]}});` +
    `var ctx={"Panier":{"lstProduits":[${lines}],"lstProduitsLight":[],"iQuantitePanier":0,` +
    `"sTotalAPayer":"${total} €"}};</script>`
  );
}
