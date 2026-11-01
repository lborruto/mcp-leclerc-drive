import assert from "node:assert/strict";
import { test } from "node:test";

import { Throttler } from "../src/leclerc/throttle.js";
import { fakeChrome, Site } from "./fake-chrome.js";
import { makeClient, storePage, tempStore, testConfig } from "./helpers.js";

const STORE = "https://fd4-courses.leclercdrive.fr";
const PAGE = storePage([{ iIdProduit: 1, sLibelleLigne1: "Pain", nrPVUnitaireTTC: 1, iQteDisponible: 1 }]);

function setup(site: Site) {
  const config = testConfig({ host: "fd4-courses.leclercdrive.fr" });
  const chrome = fakeChrome(site);
  const { store } = tempStore(config);
  return { chrome, client: makeClient(config, chrome.session, store) };
}

// Issue #2: after an idle period the store answers with a redirect to its
// fdN-secure twin. A navigation follows it (and restores the session); an
// in-page fetch cannot.
test("a fetch broken by a redirect to fdN-secure re-navigates and retries once", async () => {
  let sessionStale = false;
  const { chrome, client } = setup((url) => {
    if (url.host === "fd4-secure.leclercdrive.fr") {
      sessionStale = false;
      return { redirect: `${STORE}${url.searchParams.get("back") ?? "/"}` };
    }
    if (sessionStale) return { redirect: `https://fd4-secure.leclercdrive.fr/?back=${encodeURIComponent(url.pathname + url.search)}` };
    return { body: PAGE };
  });

  await client.searchProducts("pain"); // first navigation, page on the store
  sessionStale = true; // ...16 idle minutes later
  const products = await client.searchProducts("pain");

  assert.equal(products.length, 1);
  assert.equal(chrome.navigations.length, 2, "one fresh navigation to the store");
  assert.equal(chrome.fetches.length, 3, "first search, failed fetch, retry");
});

test("a fetch that keeps failing is retried only once, then reported", async () => {
  let calls = 0;
  const { chrome, client } = setup((url) => {
    if (url.pathname.endsWith("recherche.aspx") && url.searchParams.get("TexteRecherche") === "x") {
      calls++;
      return { redirect: "https://fd4-secure.leclercdrive.fr/" };
    }
    return { body: PAGE };
  });
  await assert.rejects(client.searchProducts("x"), /Failed to fetch/);
  assert.equal(calls, 2);
  assert.equal(chrome.navigations.length, 2);
});

test("403 is still retried with backoff, then succeeds", async () => {
  let n = 0;
  const { client } = setup((url) =>
    url.searchParams.get("TexteRecherche") === "pain" && n++ < 2 ? { status: 403 } : { body: PAGE },
  );
  assert.equal((await client.searchProducts("pain")).length, 1);
});

test("403 every time ends with an actionable message", async () => {
  const { client } = setup((url) => (url.searchParams.get("TexteRecherche") === "pain" ? { status: 403 } : { body: PAGE }));
  await assert.rejects(client.searchProducts("pain"), /HTTP 403.*fenêtre Chrome/);
});

test("the throttler runs one task at a time, in order", async () => {
  const t = new Throttler({ minIntervalMs: 5, jitterMs: 0, maxRetries: 0, backoffBaseMs: 0 });
  let running = 0;
  const order: number[] = [];
  const task = (i: number) => async () => {
    running++;
    assert.equal(running, 1, "never two at once");
    await new Promise((r) => setTimeout(r, 3));
    order.push(i);
    running--;
  };
  await Promise.all([t.run(task(1)), t.run(task(2)), t.run(async () => { throw new Error("boom"); }).catch(() => undefined), t.run(task(3))]);
  assert.deepEqual(order, [1, 2, 3]);
});
