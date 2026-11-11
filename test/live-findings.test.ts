import assert from "node:assert/strict";
import { test } from "node:test";

import { filterOffers, formatSearch, formatStores } from "../src/format.js";
import { FoundStore } from "../src/leclerc/locator.js";
import { loggedInFlag, sessionDriveFromUrl } from "../src/leclerc/parse.js";
import { fakeChrome, Site } from "./fake-chrome.js";
import { makeClient, storePage, tempStore, testConfig } from "./helpers.js";

function setup(site: Site) {
  const config = testConfig();
  const chrome = fakeChrome(site);
  const { store } = tempStore(config);
  return { chrome, client: makeClient(config, chrome.session, store) };
}

const BREAD = { iIdProduit: 1, sLibelleLigne1: "Pain", nrPVUnitaireTTC: 1, iQteDisponible: 1 };

// Seen live 2026-11-11: a search with no result carries a "zero result" panel
// that suggests a few unrelated products, in the same record shape.
test("search: the suggestions of a zero-result page are not results", async () => {
  const page = storePage([BREAD]).replace("initOptions('x'", "initOptions('ctl00_main_ucZeroResultat_pnlContenu'");
  const { client } = setup(() => ({ body: page }));
  assert.deepEqual(await client.searchProducts("zzzz"), []);
});

test("the client notes whether the page says a customer is logged in", async () => {
  const page = (flag: string) => storePage([BREAD]).replace('{"Panier"', `{"fClientConnecte":${flag},"Panier"`);
  let flag = "false";
  const { client } = setup(() => ({ body: page(flag) }));
  assert.equal(client.loggedIn, undefined);
  await client.getCart();
  assert.equal(client.loggedIn, false);
  flag = "true";
  await client.searchProducts("pain");
  assert.equal(client.loggedIn, true);
  assert.equal(loggedInFlag("<html>"), undefined);
});

test("offers: read from the promotions page once, then kept", async () => {
  const { chrome, client } = setup((url) =>
    url.pathname.endsWith("/promotions.aspx") ? { body: storePage([BREAD, { ...BREAD, iIdProduit: 2 }]) } : { body: storePage() },
  );
  assert.equal((await client.offers()).length, 2);
  assert.equal((await client.offers()).length, 2);
  assert.equal(chrome.fetches.filter((u) => u.includes("promotions.aspx")).length, 1);
});

test("filterOffers: every word, whatever the accents and case, in the label or the family", () => {
  const p = (id: string, label: string, family?: string) => ({ id, label, family, price: 1, available: true });
  const all = [p("1", "Crème fraîche épaisse"), p("2", "Café moulu", "Cafes"), p("3", "Yaourt nature", "Cremerie")];
  assert.deepEqual(filterOffers(all, "CREME").map((x) => x.id), ["1"]);
  assert.deepEqual(filterOffers(all, "cremerie").map((x) => x.id), ["3"]);
  assert.deepEqual(filterOffers(all, "creme epaisse").map((x) => x.id), ["1"]);
  assert.equal(filterOffers(all, "  ").length, 3);
  // Whole words, give or take a plural: « café » is not « caféine ».
  const drinks = [p("4", "Soda sans caféine"), p("5", "Cafés en grains"), p("6", "Filtre à café")];
  assert.deepEqual(filterOffers(drinks, "café").map((x) => x.id), ["5", "6"]);
  const text = formatSearch("café", filterOffers(all, "café"), { limit: 5, onlyAvailable: true, what: "produit(s) en promotion" });
  assert.match(text, /^1 produit\(s\) en promotion pour « café » :/);
  assert.match(formatSearch("thé", [], { limit: 5, onlyAvailable: true, what: "produit(s) en promotion" }), /Aucun produit en promotion trouvé/);
});

test("the session's drive is read from where www.leclercdrive.fr lands, and marked in find_stores", () => {
  assert.deepEqual(sessionDriveFromUrl("https://www.leclercdrive.fr/?mag=027411-027411&sRedirect=false"), {
    storeId: "027411",
    noPR: "027411",
  });
  assert.equal(sessionDriveFromUrl("https://www.leclercdrive.fr/"), undefined);
  assert.equal(sessionDriveFromUrl("https://www.leclercdrive.fr/?mag=abc"), undefined);
  const s = (key: string): FoundStore => ({ key, storeId: key, noPR: key, name: `Drive ${key}`, serviceType: "drive", host: "fd2-courses.leclercdrive.fr" });
  const stores = [s("111"), s("222")];
  assert.doesNotMatch(formatStores("x", stores), /fenêtre Chrome/);
  const marked = formatStores("x", stores, { storeId: "222", noPR: "222" });
  assert.match(marked, /Drive 222 — drive \(id=222\) ← celui de la fenêtre Chrome/);
  assert.match(formatStores("x", stores, { storeId: "999", noPR: "999" }), /sur un autre drive \(id=999\)/);
});
