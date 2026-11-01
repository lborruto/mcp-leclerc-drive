import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("a dropped connection fails what is in flight, and the next command knows it", async () => {
  const s = new ChromeSession({ profileDir: "/nonexistent", port: 1, headless: true });
  const raw = s as unknown as { attach: (ws: unknown) => void; cdp: Cdp };
  const ws: { readyState: number; send: () => void; onclose?: () => void } = { readyState: 1, send: () => undefined };
  raw.attach(ws);
  const inFlight = raw.cdp.call(s, "Runtime.evaluate");
  ws.onclose?.();
  await assert.rejects(inFlight, /connexion à Chrome a été perdue/);
  await assert.rejects(raw.cdp.call(s, "Page.enable"), /pas connecté/);
});

test("a CDP error answer rejects instead of passing as a result", async () => {
  const s = new ChromeSession({ profileDir: "/nonexistent", port: 1, headless: true });
  const raw = s as unknown as { attach: (ws: unknown) => void; cdp: Cdp };
  const ws: { readyState: number; send: (m: string) => void; onmessage?: (e: { data: string }) => void } = {
    readyState: 1,
    send: (m) => {
      const { id } = JSON.parse(m);
      queueMicrotask(() => ws.onmessage?.({ data: JSON.stringify({ id, error: { message: "No target" } }) }));
    },
  };
  raw.attach(ws);
  await assert.rejects(raw.cdp.call(s, "Page.navigate"), /refusé la commande : No target/);
});

test("a Chrome that cannot be started is reported at once, not after the 20 s wait", async () => {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r())); // a port nobody listens on
  const s = new ChromeSession({
    profileDir: mkdtempSync(join(tmpdir(), "leclerc-nochrome-")),
    port,
    headless: true,
    chromePath: join(tmpdir(), "no-such-chrome-binary"),
  });
  assert.match(await s.status(), /pas ouvert/);
  const started = Date.now();
  await assert.rejects(s.fetch({ url: "https://www.leclercdrive.fr/" }, "/"), /Chrome ne démarre pas.*ENOENT/);
  assert.ok(Date.now() - started < 5000, "failed fast");
});
