import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeChrome, Site } from "./fake-chrome.js";
import { makeClient, storePage, tempStore, testConfig } from "./helpers.js";

function setup(site: Site) {
  const config = testConfig();
  const chrome = fakeChrome(site);
  const { store } = tempStore(config);
  return makeClient(config, chrome.session, store);
}

const CART_ONLY = storePage();

// A real store page (cart marker present) whose product records are no longer
// JSON this version reads: said as such, not as "no product".
test("search: unreadable product records are reported as a changed page", async () => {
  const broken = CART_ONLY.replace('"lstElements":[]', '"lstElements":[{"objElement":{"iIdProduit":1,"fn":function(){}}}]');
  const client = setup(() => ({ body: broken }));
  await assert.rejects(client.searchProducts("pain"), /semble avoir changé sa page de recherche/);
});

test("search: products that all come out without a price are reported as a changed page", async () => {
  const page = storePage([{ iIdProduit: 1, sLibelleLigne1: "Pain", iQteDisponible: 1 }]);
  const client = setup(() => ({ body: page }));
  await assert.rejects(client.searchProducts("pain"), /semble avoir changé/);
});

test("search: a page with no product record is still just an empty result", async () => {
  const client = setup(() => ({ body: CART_ONLY }));
  assert.deepEqual(await client.searchProducts("zzz"), []);
});

test("cart: lines in the light summary but none in the full list are reported as a changed page", async () => {
  const page = CART_ONLY.replace('"lstProduitsLight":[]', '"lstProduitsLight":[{"iIdProduit":"7","iQtePanier":2}]');
  const client = setup(() => ({ body: page }));
  await assert.rejects(client.getCart(), /semble avoir changé le panier/);
});
