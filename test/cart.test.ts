import assert from "node:assert/strict";
import { test } from "node:test";

import { formatAddMany, formatCart, formatChange, formatSearch } from "../src/format.js";
import { changeFromEvents } from "../src/leclerc/client.js";
import { fakeChrome } from "./fake-chrome.js";
import { makeClient, storePage, tempStore, testConfig } from "./helpers.js";

// A simulated Leclerc cart behind panier.aspx?op=1 (capture doc §2, §3):
// iQuantite is the absolute target, stock caps it, unknown ids get no line.
const CATALOG: Record<string, { label: string; price: number; stock: number }> = {
  "11": { label: "Lait", price: 1.1, stock: 50 },
  "22": { label: "Pain", price: 0.9, stock: 3 },
  "33": { label: "Café", price: 4.5, stock: 50 },
};

function shop(opts: { failId?: string; blockAfter?: number } = {}) {
  const cart = new Map<string, number>();
  let posts = 0;
  const line = (id: string, qty: number) => ({
    sType: "Produit",
    iIdProduit: Number(id),
    sLibelleLigne1: CATALOG[id].label,
    nrPVUnitaireTTC: CATALOG[id].price,
    iQteDisponible: CATALOG[id].stock,
    iQuantitePanier: qty,
    rTotalAPayer: Math.round(CATALOG[id].price * qty * 100) / 100,
  });
  const totals = () => {
    let total = 0;
    let units = 0;
    for (const [id, q] of cart) {
      total += CATALOG[id].price * q;
      units += q;
    }
    return { rTotalAPayer: Math.round(total * 100) / 100, iQuantitePanier: units };
  };
  const chrome = fakeChrome((url, init) => {
    if (url.pathname.endsWith("/recherche.aspx")) {
      return { body: storePage([], [...cart].map(([id, q]) => line(id, q))) };
    }
    if (url.pathname.endsWith("/panier.aspx") && init.method === "POST") {
      posts++;
      if (opts.blockAfter !== undefined && posts > opts.blockAfter) return { status: 403 };
      const d = JSON.parse(decodeURIComponent(String(init.body).slice(2)));
      const id = String(d.iIdProduit);
      if (id === opts.failId) return { status: 500 };
      const events: unknown[] = [];
      if (CATALOG[id]) {
        // Like the site: action 1 only raises a line, action 2 only lowers it.
        const now = cart.get(id) ?? 0;
        const wanted = d.eTypeAction === 1 ? Math.max(now, d.iQuantite) : Math.min(now, d.iQuantite);
        const qty = Math.min(wanted, CATALOG[id].stock);
        if (qty > 0) cart.set(id, qty);
        else cart.delete(id);
        events.push({ eTypeEvenement: 101, sIdUnique: `Produit${id}`, objElement: line(id, qty) });
      }
      const t = totals();
      events.push({
        eTypeEvenement: 1,
        sIdUnique: "Panier053701",
        objElement: { ...t, fQuantiteDisponibleDepassee: CATALOG[id] ? d.iQuantite > CATALOG[id].stock : false },
      });
      return { body: JSON.stringify(events) };
    }
    return undefined;
  });
  const config = testConfig({ maxRetries: 1 });
  const { store } = tempStore(config);
  return { cart, chrome, client: makeClient(config, chrome.session, store), posts: () => posts };
}

test("add_to_cart adds on top of what is already in the cart", async () => {
  const { cart, client } = shop();
  await client.addToCart("11", 2);
  const change = await client.addToCart("11", 3);
  assert.equal(cart.get("11"), 5);
  assert.equal(change.quantity, 5);
  assert.equal(change.line?.product.label, "Lait");
  assert.equal(change.cartTotal, 5.5);
  assert.equal(change.cartItemCount, 5);
  assert.equal(change.limited, false);
});

test("update_quantity sets, remove_from_cart removes", async () => {
  const { cart, client } = shop();
  await client.addToCart("11", 4);
  assert.equal((await client.updateQuantity("11", 1)).quantity, 1);
  assert.equal(cart.get("11"), 1);
  const removed = await client.removeFromCart("11");
  assert.equal(removed.quantity, 0);
  assert.equal(cart.has("11"), false);
});

test("parallel adds of the same product add up (no lost update)", async () => {
  const { cart, client } = shop();
  await Promise.all([client.addToCart("11", 2), client.addToCart("11", 3), client.addMany([{ productId: "11", quantity: 1 }])]);
  assert.equal(cart.get("11"), 6);
});

test("update_quantity lowers a line with the decrease action", async () => {
  const { cart, client } = shop();
  await client.addToCart("33", 5);
  assert.equal((await client.updateQuantity("33", 2)).quantity, 2);
  assert.equal(cart.get("33"), 2);
});

test("a quantity capped by stock is reported, not hidden", async () => {
  const { client } = shop();
  const change = await client.addToCart("22", 5);
  assert.equal(change.quantity, 3);
  assert.equal(change.limited, true);
  assert.match(formatChange("Ajouté", change), /moins que demandé/);
});

test("an id Leclerc does not know is an error, not a silent success", async () => {
  const { client } = shop();
  await assert.rejects(client.addToCart("999", 1), /pas confirmé le produit 999/);
});

test("add_many: sequential, carries on after a failure, ends with the cart", async () => {
  const { cart, client, chrome } = shop({ failId: "22" });
  await client.addToCart("33", 1);
  const r = await client.addMany([
    { productId: "11", quantity: 2 },
    { productId: "22", quantity: 1 },
    { productId: "999", quantity: 1 },
    { productId: "33", quantity: 2 },
    { productId: "11", quantity: 1 },
  ]);
  assert.deepEqual(
    r.results.map((x) => [x.productId, x.ok]),
    [["11", true], ["22", false], ["999", false], ["33", true], ["11", true]],
  );
  assert.equal(cart.get("11"), 3, "the same product twice adds up");
  assert.equal(cart.get("33"), 3, "added on top of what was there");
  assert.equal(r.cart?.items.length, 2);
  assert.match(r.results[1].error ?? "", /HTTP 500/);
  // one cart read before, five posts, one cart read after (plus the earlier add's read + post)
  const reads = chrome.fetches.filter((u) => u.includes("recherche.aspx")).length;
  assert.equal(reads, 3);
  const text = formatAddMany(r);
  assert.match(text, /^3\/5 ajout\(s\) réussi\(s\)/);
  assert.match(text, /✗ 22 ×1 — Panier : HTTP 500/);
});

test("add_many stops at a block instead of hammering a blocked site", async () => {
  const { client, posts } = shop({ blockAfter: 1 });
  const r = await client.addMany([
    { productId: "11", quantity: 1 },
    { productId: "33", quantity: 1 },
    { productId: "22", quantity: 1 },
    { productId: "11", quantity: 1 },
  ]);
  assert.deepEqual(r.results.map((x) => x.ok), [true, false, false, false]);
  assert.match(r.results[1].error ?? "", /Bloqué/);
  assert.match(r.results[2].error ?? "", /non tenté/);
  assert.equal(posts(), 3, "1 success + the blocked one with its single retry, nothing after");
});

test("an id that comes back as a line at 0 (seen live) is a failure", () => {
  assert.throws(
    () => changeFromEvents([{ sIdUnique: "Produit999999999", objElement: { iIdProduit: 999999999, iQuantitePanier: 0 } }], "999999999", 1),
    /n'a pas ajouté le produit 999999999/,
  );
  // ...while a removal reaching 0 is what was asked.
  assert.equal(changeFromEvents([{ sIdUnique: "Produit5", objElement: { iIdProduit: 5, iQuantitePanier: 0 } }], "5", 0).quantity, 0);
});

test("changeFromEvents reads the line and the totals", () => {
  const c = changeFromEvents(
    [
      { sIdUnique: "Produit7", objElement: { sType: "Produit", iIdProduit: 7, sLibelleLigne1: "X", nrPVUnitaireTTC: 2, iQuantitePanier: 2, rTotalAPayer: 4 } },
      { sIdUnique: "Rayon3", objElement: {} },
      { sIdUnique: "Panier053701", objElement: { sTotalAPayer: "12,30 €", iQuantitePanier: 6 } },
    ],
    "7",
    2,
  );
  assert.deepEqual(
    { q: c.quantity, total: c.cartTotal, units: c.cartItemCount, limited: c.limited, line: c.line?.lineTotal },
    { q: 2, total: 12.3, units: 6, limited: false, line: 4 },
  );
});

test("formatCart shows lines, products, units and the total", () => {
  const text = formatCart({
    storeId: "053701",
    total: 3.1,
    itemCount: 3,
    items: [
      { product: { id: "11", label: "Lait", price: 1.1, available: true }, quantity: 1, lineTotal: 1.1 },
      { product: { id: "22", label: "Pain", price: 1, available: true }, quantity: 2, lineTotal: 2 },
    ],
  });
  assert.match(text, /2 produit\(s\), 3 article\(s\)/);
  assert.match(text, /• 2× Pain — 2,00 € \(id=22\)/);
  assert.match(text, /Total : 3,10 €$/);
});

test("formatSearch: available first, limited, with what was left out", () => {
  const p = (id: string, available: boolean) => ({ id, label: `P${id}`, price: 1, available });
  const products = [p("1", false), p("2", true), p("3", true), p("4", false)];
  const text = formatSearch("x", products, { limit: 2, onlyAvailable: false });
  assert.match(text, /^4 produit\(s\) pour « x », les 2 premiers :/);
  assert.deepEqual([...text.matchAll(/id=(\d)/g)].map((m) => m[1]), ["2", "3"]);
  assert.match(text, /… 2 autre\(s\)/);
  const only = formatSearch("x", products, { limit: 20, onlyAvailable: true });
  assert.deepEqual([...only.matchAll(/id=(\d)/g)].map((m) => m[1]), ["2", "3"]);
  assert.match(formatSearch("x", [p("1", false)], { limit: 5, onlyAvailable: true }), /Aucun produit disponible.*1 indisponible/);
  assert.match(formatSearch("x", [], { limit: 5, onlyAvailable: false }), /Aucun produit trouvé/);
});
