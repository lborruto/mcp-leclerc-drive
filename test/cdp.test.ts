import assert from "node:assert/strict";
import { test } from "node:test";

import { ChromeSession } from "../src/browser.js";

type Cdp = (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>;

function session() {
  const s = new ChromeSession({ profileDir: "/nonexistent", port: 1, headless: true });
  const raw = s as unknown as { ws: unknown; cdp: Cdp };
  return { raw, cdp: raw.cdp.bind(s) as Cdp };
}

test("a CDP command with no Chrome connected fails at once", async () => {
  const { cdp } = session();
  await assert.rejects(cdp("Page.enable"), /pas connecté/);
});

test("a CDP command Chrome never answers times out instead of hanging", async () => {
  const { raw, cdp } = session();
  const sent: string[] = [];
  raw.ws = { readyState: 1, send: (m: string) => sent.push(m) };
  await assert.rejects(cdp("Runtime.evaluate", {}, 20), /ne répond pas/);
  assert.equal(sent.length, 1);
});
