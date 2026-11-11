import assert from "node:assert/strict";
import { test } from "node:test";

import { formatProduct } from "../src/format.js";
import {
  assertStorePage,
  decodeEntities,
  withoutCartContext,
  extractArrayNamed,
  extractCartTotal,
  mapProduct,
  parseEuro,
  scanProductRecords,
} from "../src/leclerc/parse.js";

// Synthetic page shaped like a real search page (docs/api-capture.md §1, §3):
// widget init calls carrying objElement records, plus the cart context.
// Every value is invented.
const product = (id: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    sType: "Produit",
    iIdProduit: id,
    sLibelleLigne1: "Lait demi-&#233;cr&#233;m&#233;",
    sLibelleLigne2: "Bio 1L",
    nrPVUnitaireTTC: 1.29,
    sPrixUnitaire: "1,29 €",
    sPrixParUniteDeMesure: "1,29 € / L",
    iQteDisponible: 12,
    sUrlVignetteProduit: "https://fd9-courses.leclercdrive.fr/x.jpg",
    sUrlVoirRayon: "https://fd9-courses.leclercdrive.fr/magasin-053701-X/rayon-284370-Lait-et-Boissons-lactees.aspx",
    nrContenanceTotale: 1,
    sUniteMesureTotale: "l",
    objAvisClient: { Note: { Valeur: 4.5 }, NbAvis: 149 },
    sTexteLogoCoupon: "",
    sPrixPromo: "0,00 €",
    ...extra,
  });

const SEARCH_PAGE = `<html><script>
Utilitaires.widget.initOptions('ctl00_pnlElementProduit', {"objContenu":{"lstElements":[
  {"objElement":${product(2612)}},
  {"objElement":${product(2613, { iQteDisponible: 0, sLibelleLigne1: 'Caf&eacute; "moulu" {fort}' })}},
  {"objElement":${product(2612)}}
]}, "fnRendu": function () { return "{\\"iIdProduit\\":1}"; }});
var ctx = {"Panier":{"lstProduits":[${product(2612, { iQuantitePanier: 2, rTotalAPayer: 2.58 })}],
"lstProduitsLight":[{"iIdProduit":"2612","iQtePanier":2,"rTotalAPayer":2.58}],
"iQuantitePanier":2,"sTotalHorsReductions":"2,58 €","sTotalAPayer":"2,58 €"}};
</script></html>`;

test("scanProductRecords finds every objElement, duplicates included", () => {
  const ids = scanProductRecords(SEARCH_PAGE).map((r) => String(r.iIdProduit));
  // 3 in the widget + 1 in lstProduits + 1 in lstProduitsLight
  assert.deepEqual(ids, ["2612", "2613", "2612", "2612", "2612"]);
});

test("scanProductRecords keeps braces and quotes inside strings intact", () => {
  const coffee = scanProductRecords(SEARCH_PAGE).find((r) => String(r.iIdProduit) === "2613");
  assert.equal(coffee?.sLibelleLigne1, 'Caf&eacute; "moulu" {fort}');
});

test("mapProduct builds a Product from a raw record", () => {
  const [raw] = scanProductRecords(SEARCH_PAGE);
  assert.deepEqual(mapProduct(raw), {
    id: "2612",
    label: "Lait demi-écrémé Bio 1L",
    price: 1.29,
    offer: undefined,
    promoPrice: undefined,
    origin: undefined,
    pricePerUnit: "1,29 € / L",
    pricePerUnitValue: undefined,
    size: "1 l",
    family: "Lait et Boissons lactees",
    rating: { stars: 4.5, reviews: 149 },
    available: true,
    inCart: undefined,
    imageUrl: "https://fd9-courses.leclercdrive.fr/x.jpg",
  });
});

test("mapProduct marks out-of-stock items unavailable and falls back on the formatted price", () => {
  const p = mapProduct({ iIdProduit: 7, sPrixUnitaire: "11,88 €", iQteDisponible: 0 });
  assert.equal(p.available, false);
  assert.equal(p.price, 11.88);
  assert.equal(p.label, "Produit 7");
});

test("extractArrayNamed matches the exact key, not a longer one", () => {
  const arr = extractArrayNamed(SEARCH_PAGE, "lstProduits");
  assert.ok(arr);
  assert.ok(arr.startsWith("[") && arr.endsWith("]"));
  assert.equal(JSON.parse(arr)[0].iQuantitePanier, 2);
  assert.equal(extractArrayNamed(SEARCH_PAGE, "absent"), null);
});

test("extractCartTotal reads the grand total next to lstProduitsLight", () => {
  assert.equal(extractCartTotal(SEARCH_PAGE), "2,58 €");
});

test("parseEuro handles French formatting", () => {
  assert.equal(parseEuro("11,88 €"), 11.88);
  assert.equal(parseEuro("0,5"), 0.5);
  assert.equal(parseEuro(3), undefined);
});

test("decodeEntities decodes numeric and named entities", () => {
  assert.equal(decodeEntities("Caf&#233; &amp; th&#xE9; &quot;x&quot; &#39;y&#39;&nbsp;z"), `Café & thé "x" 'y' z`);
});

test("decodeEntities decodes once and never throws", () => {
  assert.equal(decodeEntities("&#38;lt;b&#38;gt; &amp;amp;"), "&lt;b&gt; &amp;");
  assert.equal(decodeEntities("x&#99999999;y &#0; &bogus;"), "x&#99999999;y &#0; &bogus;");
});

test("assertStorePage accepts a store page and explains block pages", () => {
  assert.doesNotThrow(() => assertStorePage(SEARCH_PAGE));
  assert.throws(() => assertStorePage("<html>Votre session a expiré</html>"), /Session Leclerc Drive expirée/);
  assert.throws(() => assertStorePage("<html>captcha</html>"), /DataDome/);
});

test("mapProduct exposes only what the record has: offer, size in pieces, cart quantity", () => {
  const p = mapProduct({
    iIdProduit: 9,
    nrPVUnitaireTTC: 1.84,
    sTexteLogoCoupon: "B&#233;n&#233;ficiez de 0.40 € de remise imm&#233;diate.",
    nrContenanceTotale: 4,
    sUniteMesureTotale: "p",
    iQuantitePanier: 2,
    objAvisClient: {},
    sUrlVoirRayon: "https://fd2-courses.leclercdrive.fr/magasin-1-X/fiche-produits-9-X.aspx",
  });
  assert.equal(p.offer, "Bénéficiez de 0.40 € de remise immédiate.");
  assert.equal(p.size, "4 pièces");
  assert.equal(p.inCart, 2);
  assert.equal(p.rating, undefined, "no reviews, no rating");
  assert.equal(p.family, undefined, "not a family link");
});

test("withoutCartContext leaves the page's own records only", () => {
  const ids = scanProductRecords(withoutCartContext(SEARCH_PAGE)).map((r) => String(r.iIdProduit));
  assert.deepEqual(ids, ["2612", "2613", "2612"]);
  assert.match(withoutCartContext(SEARCH_PAGE), /"lstProduits":\[\],\s*"lstProduitsLight":\[\]/);
});

test("mapProduct reads lot and immediate-discount offers, the discounted price and the origin", () => {
  const p = mapProduct({
    iIdProduit: 9,
    sLibelleLigne1: "Tomates",
    nrPVUnitaireTTC: 2.5,
    iQteDisponible: 3,
    sTexteTooltipLot: "Avantage imm&#233;diat de 20%",
    nrPVBRIIDeduit: 2,
    lstMentionsProduit: [
      { sLibelleMention: "Catégorie", sLibelleValeur: "1" },
      { sLibelleMention: "Origine", sLibelleValeur: "FRANCE" },
    ],
  });
  assert.equal(p.offer, "Avantage immédiat de 20%");
  assert.equal(p.promoPrice, 2);
  assert.equal(p.origin, "FRANCE");
  assert.match(formatProduct(p), /Tomates — 2,50 € \(2,00 € remise déduite\) 🏷️ Avantage immédiat de 20% · origine FRANCE id=9/);
  // A "discounted" price that is not lower is not shown.
  assert.equal(mapProduct({ iIdProduit: 9, nrPVUnitaireTTC: 2, nrPVBRIIDeduit: 2 }).promoPrice, undefined);
});
