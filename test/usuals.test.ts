import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { formatUsuals } from "../src/format.js";
import { Usuals } from "../src/usuals.js";

const file = () => join(mkdtempSync(join(tmpdir(), "leclerc-test-usuals-")), "sub", "habituels.json");

test("usual products are saved per store, by a name matched whatever its case", () => {
  const f = file();
  const u = new Usuals(f);
  assert.equal(u.save("053701", "  Lait  Demi ", "2612", "Lait demi-écrémé"), undefined);
  u.save("053701", "café", "33");
  u.save("027411", "lait", "9");
  assert.deepEqual(new Usuals(f).list("053701"), [
    { name: "café", productId: "33", label: undefined },
    { name: "lait demi", productId: "2612", label: "Lait demi-écrémé" },
  ]);
  // Replacing says what was there; forgetting too.
  assert.deepEqual(u.save("053701", "LAIT DEMI", "2613"), { name: "lait demi", productId: "2612", label: "Lait demi-écrémé" });
  assert.deepEqual(u.forget("053701", "Café"), { name: "café", productId: "33", label: undefined });
  assert.equal(u.forget("053701", "café"), undefined);
  assert.deepEqual(u.list("027411").map((x) => x.productId), ["9"]);
  assert.match(formatUsuals("053701", u.list("053701")), /• lait demi → produit \(id=2613\)/);
  assert.match(formatUsuals("1", []), /Aucun produit habituel/);
});

test("a corrupt or hand-edited file never breaks the tools: invalid entries are ignored", () => {
  const f = file();
  const u = new Usuals(f);
  u.save("053701", "lait", "2612");
  writeFileSync(f, "{not json");
  assert.deepEqual(u.list("053701"), []);
  writeFileSync(f, JSON.stringify({ "053701": { lait: { productId: "12" }, bad: { productId: "x; rm" } }, "../x": { a: { productId: "1" } } }));
  assert.deepEqual(u.list("053701"), [{ name: "lait", productId: "12", label: undefined }]);
  u.save("053701", "pain", "5");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(f, "utf8"))), ["053701"]);
});
