#!/usr/bin/env node
/**
 * Manual end-to-end smoke test against the LIVE site, through the real Chrome.
 * The server's Chrome window opens: log into Leclerc Drive in it first, on the
 * store selected with set_store (or LECLERC_STORE_ID / LECLERC_HOST).
 *
 * ⚠️ This touches your real Leclerc Drive cart: it adds one available product,
 * changes its quantity, then removes it. A product already in your cart is
 * skipped, so nothing of yours is changed. About ten requests, throttled.
 *
 *   npm run build && npm run smoke [search-term]
 */

import { ChromeSession } from "../dist/browser.js";
import { loadConfig } from "../dist/config.js";
import { LeclercClient } from "../dist/leclerc/client.js";
import { PageHttp } from "../dist/leclerc/http.js";
import { Throttler } from "../dist/leclerc/throttle.js";
import { StoreState } from "../dist/store.js";

const term = process.argv[2] || "café";
const config = loadConfig();
const browser = new ChromeSession({
  chromePath: config.chromePath,
  profileDir: config.chromeProfileDir,
  port: config.chromePort,
  headless: config.headless,
});
const store = new StoreState(config);
const client = new LeclercClient(new PageHttp(browser, new Throttler(config)), store);

const showCart = (label, c) =>
  console.log(
    `${label}: ${c.items.length} line(s), ${c.itemCount} unit(s), ${c.total} EUR — ` +
      (c.items.map((i) => `${i.quantity}x ${i.product.label} [${i.product.id}]`).join(" | ") || "(empty)"),
  );
const showChange = (label, c) =>
  console.log(`${label}: ${c.productId} → ${c.quantity}${c.limited ? " (limited)" : ""}, cart ${c.cartTotal} EUR`);

try {
  const s = store.current();
  console.log(`Store ${s.storeId} @ ${s.host}\n`);

  const before = await client.getCart();
  showCart("0) get_cart", before);
  const mine = new Set(before.items.map((i) => i.product.id));

  const products = await client.searchProducts(term);
  console.log(`1) search_product("${term}") → ${products.length} products`);
  const target = products.find((p) => p.available && !mine.has(p.id));
  if (!target) throw new Error("No available product outside your cart to test with.");
  console.log(`   using: ${target.label} [${target.id}] @ ${target.price} EUR`);

  showChange("2) add_to_cart(+1)", await client.addToCart(target.id, 1));
  showChange("3) add_to_cart(+1)", await client.addToCart(target.id, 1));
  showChange("4) update_quantity(1)", await client.updateQuantity(target.id, 1));
  showChange("5) remove_from_cart", await client.removeFromCart(target.id));
  showCart("6) get_cart", await client.getCart());

  console.log("\n✓ smoke test complete (cart as it was).");
} finally {
  await browser.close();
}
