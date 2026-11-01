import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ChromeSession } from "../src/browser.js";
import { assertNotMainProfile, foreignChromeReason, LOCK_FILE, writeLock } from "../src/chrome-profile.js";
import { loadConfig } from "../src/config.js";
import { assertAllowedUrl, isAllowedHost, parseStoreHost } from "../src/hosts.js";
import { StoreLocator } from "../src/leclerc/locator.js";
import { StoreState } from "../src/store.js";
import { fakeChrome } from "./fake-chrome.js";
import { makeHttp, testConfig } from "./helpers.js";

// ---- Host allowlist --------------------------------------------------------

test("allowlist: Leclerc Drive hosts in, look-alikes out", () => {
  for (const h of [
    "fd1-courses.leclercdrive.fr",
    "fd14-secure.leclercdrive.fr",
    "www.leclercdrive.fr",
    "api-recherchemagasins.leclercdrive.fr",
  ]) assert.ok(isAllowedHost(h), h);
  for (const h of [
    "leclercdrive.fr",
    "fd-courses.leclercdrive.fr",
    "fd1-photos.leclercdrive.fr",
    "fd1-courses.leclercdrive.fr.evil.example",
    "evil.example",
    "xfd1-courses.leclercdrive.fr",
    "fd1-courses.leclercdrive.fr.",
    "api-recherchemagasins.leclercdrive.fr.evil.example",
  ]) assert.ok(!isAllowedHost(h), h);
});

test("assertAllowedUrl: https only, no port, no credentials", () => {
  assert.equal(assertAllowedUrl("https://www.leclercdrive.fr/x").host, "www.leclercdrive.fr");
  for (const u of [
    "http://www.leclercdrive.fr/",
    "https://www.leclercdrive.fr:8443/",
    "https://user:pw@www.leclercdrive.fr/",
    "https://evil.example/?u=https://www.leclercdrive.fr/",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "not a url",
  ]) assert.throws(() => assertAllowedUrl(u), /refusé|invalide/, u);
});

test("parseStoreHost accepts store hosts and URLs on them, nothing else", () => {
  assert.equal(parseStoreHost("fd9-courses.leclercdrive.fr"), "fd9-courses.leclercdrive.fr");
  assert.equal(parseStoreHost(" FD9-Courses.LeclercDrive.fr "), "fd9-courses.leclercdrive.fr");
  assert.equal(parseStoreHost("https://fd10-courses.leclercdrive.fr/magasin-1-1/"), "fd10-courses.leclercdrive.fr");
  for (const h of ["fd9-secure.leclercdrive.fr", "www.leclercdrive.fr", "evil.example", "http://fd9-courses.leclercdrive.fr/", "https://fd9-courses.leclercdrive.fr:444/"]) {
    assert.throws(() => parseStoreHost(h), /invalide/, h);
  }
});

test("the browser refuses to fetch or navigate outside the allowlist", async () => {
  const chrome = fakeChrome(() => ({ body: "ok" }));
  await assert.rejects(chrome.session.fetch({ url: "https://evil.example/" }, "/"), /refusé/);
  await assert.rejects(
    chrome.session.fetch({ url: "https://www.leclercdrive.fr/" }, "https://evil.example/steal"),
    /refusé/,
  );
  assert.equal(chrome.fetches.length, 0);
  assert.deepEqual(chrome.navigations, ["https://www.leclercdrive.fr/"]);
});

test("an in-page fetch redirected off the allowlist is refused, even with CORS", async () => {
  const chrome = fakeChrome((url) => {
    if (url.host === "www.leclercdrive.fr" && url.pathname === "/go") return { redirect: "https://evil.example/data" };
    if (url.host === "evil.example") return { body: '{"fake":true}', cors: true };
    return { body: "home" };
  });
  await assert.rejects(chrome.session.fetch({ url: "https://www.leclercdrive.fr/" }, "/go"), /redirection hors liste : evil\.example/);
});

test("a tab that moved away by itself is not used: the server navigates back", async () => {
  const chrome = fakeChrome((url) => (url.host === "www.leclercdrive.fr" ? { body: `page ${url.pathname}` } : { body: "x" }));
  const http = makeHttp(testConfig(), chrome.session);
  const page = () => ({ url: "https://www.leclercdrive.fr/" });
  const blocked = () => "blocked";
  assert.equal((await http.request(page, "/a", { blockedMessage: blocked })).text(), "page /a");
  chrome.moveTab("https://fd9-secure.leclercdrive.fr/login");
  const res = await http.request(page, "/b", { blockedMessage: blocked });
  assert.equal(res.text(), "page /b");
  assert.equal(chrome.navigations.length, 2);
});

test("a navigation redirected off the allowlist stops there", async () => {
  const chrome = fakeChrome((url) =>
    url.host === "www.leclercdrive.fr" ? { redirect: "https://evil.example/" } : { body: "x" },
  );
  await assert.rejects(chrome.session.fetch({ url: "https://www.leclercdrive.fr/" }, "/"), /hors de Leclerc Drive/);
  assert.equal(chrome.fetches.length, 0);
});

test("the locator drops stores whose host or ids are not plain Leclerc ones", async () => {
  const points = [
    { noPL: "053701", noPR: "053701", name: "Bon", serviceType: "drive", urlSiteCourse: "https://fd9-courses.leclercdrive.fr/magasin-053701-053701-X.aspx" },
    { noPL: "1", name: "Ailleurs", urlSiteCourse: "https://evil.example/" },
    { noPL: "2", name: "Secure", urlSiteCourse: "https://fd9-secure.leclercdrive.fr/" },
    { noPL: "../x", name: "Chemin", urlSiteCourse: "https://fd9-courses.leclercdrive.fr/" },
  ];
  // Only the mapping of the API's answers is under test: the three JSON calls
  // are stubbed.
  const http = makeHttp(testConfig(), fakeChrome(() => undefined).session);
  const locator = new StoreLocator(http) as unknown as { getJson: (u: string) => Promise<unknown> };
  const answers = [{ postalCodes: [{ id: "abc", postalCode: "37700" }] }, { latitude: 1, longitude: 2 }, { points }];
  locator.getJson = async () => answers.shift();
  const found = await (locator as unknown as StoreLocator).findStores("37700");
  assert.deepEqual(found.map((s) => s.name), ["Bon"]);
});

test("relays sharing their drive's id get their own id (seen live)", async () => {
  const host = "https://fd2-courses.leclercdrive.fr/";
  const points = [
    { noPL: "027411", noPR: "027411", name: "Drive ", serviceType: "drive", urlSiteCourse: host },
    { noPL: "027411", noPR: "027499", name: "Relais A", serviceType: "relais camion", urlSiteCourse: host },
    { noPL: "027411", noPR: "027499", name: "Relais B", serviceType: "relais camion", urlSiteCourse: host },
  ];
  const locator = new StoreLocator(makeHttp(testConfig(), fakeChrome(() => undefined).session)) as unknown as {
    getJson: () => Promise<unknown>;
    findStores: StoreLocator["findStores"];
  };
  const answers = [{ postalCodes: [{ id: "abc", postalCode: "74100" }] }, { latitude: 1, longitude: 2 }, { points }];
  locator.getJson = async () => answers.shift();
  const found = await locator.findStores("74100");
  assert.deepEqual(found.map((s) => [s.key, s.name]), [["027411", "Drive"], ["027411-027499", "Relais A"], ["027411-027499-2", "Relais B"]]);
});

// ---- Main profile guard ----------------------------------------------------

test("refuses the main Chrome profile, and folders inside it, on each OS", () => {
  const home = "/home/alice";
  const cases: Array<[NodeJS.Platform, string, Record<string, string>]> = [
    ["darwin", "/Users/alice/Library/Application Support/Google/Chrome", {}],
    ["darwin", "/Users/alice/library/application support/google/chrome/Default", {}],
    ["linux", "/home/alice/.config/google-chrome", {}],
    ["linux", "/home/alice/.config/chromium/Profile 1", {}],
    ["linux", "/xdg/google-chrome", { XDG_CONFIG_HOME: "/xdg" }],
    ["win32", "C:\\Users\\alice\\AppData\\Local\\Google\\Chrome\\User Data", { LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" }],
  ];
  for (const [os, dir, env] of cases) {
    const h = os === "darwin" ? "/Users/alice" : os === "win32" ? "C:\\Users\\alice" : home;
    if (os === "win32" && process.platform !== "win32") continue; // Windows paths need Windows path rules
    assert.throws(() => assertNotMainProfile(dir, os, h, env), /profil principal/, `${os} ${dir}`);
  }
});

test("accepts the dedicated profile and look-alike folder names", () => {
  assert.doesNotThrow(() => assertNotMainProfile("/home/alice/.mcp-leclerc-drive/chrome", "linux", "/home/alice", {}));
  assert.doesNotThrow(() => assertNotMainProfile("/home/alice/.config/google-chrome-leclerc", "linux", "/home/alice", {}));
});

// ---- Lock: never attach to a Chrome the server did not start -----------------

function profile(): string {
  const dir = mkdtempSync(join(tmpdir(), "leclerc-lock-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("foreignChromeReason: lock, port, PID and browser id must all match", () => {
  const dir = profile();
  const id = "/devtools/browser/1111-2222";
  assert.match(foreignChromeReason(dir, 9333, id) ?? "", /aucun verrou/);

  writeLock(dir, process.pid, 9444, id);
  assert.match(foreignChromeReason(dir, 9333, id) ?? "", /port 9444/);

  writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: 2 ** 22 + 12345, port: 9333, browser: id }));
  assert.match(foreignChromeReason(dir, 9333, id) ?? "", /n'existe plus/);

  writeLock(dir, process.pid, 9333, id);
  assert.match(foreignChromeReason(dir, 9333, "/devtools/browser/other") ?? "", /pas le Chrome du verrou/);
  assert.match(foreignChromeReason(dir, 9333, null) ?? "", /pas le Chrome du verrou/);
  assert.equal(foreignChromeReason(dir, 9333, id), null, "no DevToolsActivePort file: still ours");

  writeFileSync(join(dir, "DevToolsActivePort"), "9555\n/devtools/browser/x\n");
  assert.match(foreignChromeReason(dir, 9333, id) ?? "", /profil du serveur/);
  writeFileSync(join(dir, "DevToolsActivePort"), "9333\n/devtools/browser/x\n");
  assert.equal(foreignChromeReason(dir, 9333, id), null);

  // An old lock without the browser id is not trusted.
  writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ pid: process.pid, port: 9333 }));
  assert.match(foreignChromeReason(dir, 9333, id) ?? "", /aucun verrou/);
});

test("a debug endpoint already on the port, not started by the server, is refused", async () => {
  let listCalls = 0;
  const server = createServer((req, res) => {
    if (req.url === "/json/version") {
      return res.end(JSON.stringify({ Browser: "Chrome/999", webSocketDebuggerUrl: "ws://evil.example/devtools/browser/abc" }));
    }
    listCalls++;
    res.end("[]");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    const session = new ChromeSession({ profileDir: profile(), port, headless: true });
    assert.match(await session.status(), /pris par un autre programme/);
    await assert.rejects(session.fetch({ url: "https://www.leclercdrive.fr/" }, "/"), /ne s'y connecte pas/);
    assert.equal(listCalls, 0, "never listed its tabs");
  } finally {
    server.close();
  }
});

// ---- Config and saved selection ---------------------------------------------

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("config: port 9333 by default, LECLERC_HOST and LECLERC_STORE_ID validated", () => {
  const clean = { LECLERC_CHROME_PORT: undefined, LECLERC_HOST: undefined, LECLERC_STORE_ID: undefined };
  assert.equal(withEnv(clean, loadConfig).chromePort, 9333);
  assert.equal(withEnv({ ...clean, LECLERC_CHROME_PORT: "9555" }, loadConfig).chromePort, 9555);
  assert.equal(
    withEnv({ ...clean, LECLERC_HOST: "https://fd4-courses.leclercdrive.fr/" }, loadConfig).host,
    "fd4-courses.leclercdrive.fr",
  );
  assert.throws(() => withEnv({ ...clean, LECLERC_HOST: "evil.example" }, loadConfig), /invalide/);
  assert.throws(() => withEnv({ ...clean, LECLERC_STORE_ID: "../../x" }, loadConfig), /invalide/);
  assert.throws(() => withEnv({ ...clean, LECLERC_CHROME_PORT: "80" }, loadConfig), /invalide/);
});

test("a saved store selection with a foreign host is ignored", () => {
  const file = join(profile(), "config.json");
  writeFileSync(file, JSON.stringify({ storeId: "053701", host: "evil.example" }));
  const store = new StoreState(testConfig(), file);
  assert.equal(store.current().host, "fd9-courses.leclercdrive.fr");
  assert.throws(() => store.set({ storeId: "1", noPR: "1", host: "evil.example" }), /invalide/);
});
