import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { fakeChrome, Site } from "./fake-chrome.js";
import { makeClient, storePage, tempStore, testConfig } from "./helpers.js";

// Issue #1: the locator gives a generic host (fd1-courses) that 302s to the
// store's own shard; every in-page fetch on fd1 is then cross-origin.
const SHARDS: Record<string, string> = { "085111": "fd10", "085112": "fd11" };

const site: Site = (url) => {
  const m = url.pathname.match(/^\/magasin-(\d+)-[^/]+\/(.*)$/);
  if (!m) return undefined;
  const [, id, rest] = m;
  const shard = SHARDS[id];
  if (url.host === "fd1-courses.leclercdrive.fr" && shard) {
    return { redirect: `https://${shard}-courses.leclercdrive.fr/magasin-${id}-Slug-Cosmetique/${rest}${url.search}` };
  }
  if (url.host === `${shard}-courses.leclercdrive.fr` && rest === "recherche.aspx") {
    return { body: storePage([{ iIdProduit: Number(id.slice(-2)), sLibelleLigne1: `Produit du ${id}`, nrPVUnitaireTTC: 1, iQteDisponible: 3 }]) };
  }
  return undefined;
};

function setup() {
  const config = testConfig();
  const chrome = fakeChrome(site);
  const { store, file } = tempStore(config);
  store.set({ storeId: "085111", noPR: "085111", host: "fd1-courses.leclercdrive.fr" });
  const client = makeClient(config, chrome.session, store);
  return { chrome, store, file, client };
}

test("search works when the store host redirects to another shard", async () => {
  const { chrome, client } = setup();
  const products = await client.searchProducts("lait");
  assert.equal(products.length, 1);
  assert.equal(products[0].label, "Produit du 085111");
  // The fetch ran on the shard the page landed on, not on fd1.
  assert.match(chrome.fetches[0], /^https:\/\/fd10-courses\.leclercdrive\.fr\/magasin-085111-085111\/recherche\.aspx\?TexteRecherche=lait$/);
});

test("the corrected host is persisted and reused without a new navigation", async () => {
  const { chrome, store, file, client } = setup();
  await client.searchProducts("lait");
  assert.equal(store.current().host, "fd10-courses.leclercdrive.fr");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).host, "fd10-courses.leclercdrive.fr");

  await client.searchProducts("pain");
  assert.equal(chrome.navigations.length, 1, "the page already on the store is reused");
});

test("switching to another store behind the same generic host navigates again", async () => {
  const { chrome, store, client } = setup();
  await client.searchProducts("lait");
  store.set({ storeId: "085112", noPR: "085112", host: "fd1-courses.leclercdrive.fr" });
  const products = await client.searchProducts("lait");
  assert.equal(products[0].label, "Produit du 085112");
  assert.equal(chrome.navigations.length, 2);
  assert.equal(store.current().host, "fd11-courses.leclercdrive.fr");
});

test("a page that lands off the store explains what to do", async () => {
  const config = testConfig();
  const chrome = fakeChrome((url) =>
    url.host === "fd9-courses.leclercdrive.fr" ? { redirect: "https://www.leclercdrive.fr/" } : { body: "accueil" },
  );
  const { store } = tempStore(config);
  const client = makeClient(config, chrome.session, store);
  await assert.rejects(client.searchProducts("lait"), /atterri sur https:\/\/www\.leclercdrive\.fr\/.*connecté/);
});

test("a set_store during a request does not give the new store the old one's shard", async () => {
  const { store, client } = setup();
  const search = client.searchProducts("lait"); // 085111 via fd1, lands on fd10
  store.set({ storeId: "222222", noPR: "222222", host: "fd1-courses.leclercdrive.fr" });
  await search;
  assert.deepEqual(store.current(), { storeId: "222222", noPR: "222222", host: "fd1-courses.leclercdrive.fr" });
});

test("search results never include cart lines", async () => {
  const config = testConfig();
  const page = storePage(
    [{ iIdProduit: 1, sLibelleLigne1: "Petits pois", nrPVUnitaireTTC: 1, iQteDisponible: 5 }],
    [{ iIdProduit: 2, sLibelleLigne1: "Boisson végétale", nrPVUnitaireTTC: 2, iQuantitePanier: 1, rTotalAPayer: 2 }],
  );
  const chrome = fakeChrome(() => ({ body: page }));
  const { store } = tempStore(config);
  const products = await makeClient(config, chrome.session, store).searchProducts("petits pois");
  assert.deepEqual(products.map((p) => p.label), ["Petits pois"]);
});
