/**
 * A stand-in for Chrome behind ChromeSession: the real ChromeSession code runs,
 * but its CDP calls are answered by a tiny simulated browser with one tab.
 *
 * - Page.navigate follows `site` redirects (any origin, like a real navigation).
 * - The in-page script ChromeSession sends is really run, in a node:vm sandbox
 *   with a simulated `location` and `fetch`: the checks it makes in the page
 *   (tab still on the expected origin, redirect hosts) are the real code.
 * - The simulated fetch is same-origin-only, like a fetch with no CORS
 *   headers: a request, or a redirect, to another origin fails with
 *   "TypeError: Failed to fetch" — unless the response says `cors: true`.
 */

import { mkdtempSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ChromeOptions, ChromeSession } from "../src/browser.js";

export interface FakeResponse {
  status?: number;
  body?: string;
  /** Absolute URL to redirect to (302). */
  redirect?: string;
  /** This response allows cross-origin reads with credentials (CORS). */
  cors?: boolean;
}

/** Route table: return a response for a URL, or undefined for a 404. */
export type Site = (url: URL, init: { method: string; body?: string }) => FakeResponse | undefined;

export interface FakeChrome {
  session: ChromeSession;
  /** Every Page.navigate URL, in order. */
  navigations: string[];
  /** Every in-page fetch URL (absolute, as the page resolved it), in order. */
  fetches: string[];
  /** Current tab URL. */
  location(): string;
  /** Move the tab by itself (page script, session expiry, a person clicking). */
  moveTab(url: string): void;
}

const MAX_REDIRECTS = 5;

export function fakeChrome(site: Site, opts: Partial<ChromeOptions> = {}): FakeChrome {
  const session = new ChromeSession({
    profileDir: mkdtempSync(join(tmpdir(), "leclerc-test-profile-")),
    port: 0,
    headless: true,
    settleMs: 0,
    ...opts,
  });
  let location = "about:blank";
  const navigations: string[] = [];
  const fetches: string[] = [];

  const resolve = (url: string, init: { method: string; body?: string }) => {
    let u = new URL(url);
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const r = site(u, init);
      if (!r?.redirect) return { url: u, res: r };
      u = new URL(r.redirect, u);
    }
    throw new Error("too many redirects");
  };

  const s = session as unknown as Record<string, unknown>;
  s.ensureLaunched = async () => undefined;
  s.waitEvent = async () => undefined;
  s.cdp = async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "Page.navigate") {
      navigations.push(String(params.url));
      location = resolve(String(params.url), { method: "GET" }).url.href;
      return { result: { frameId: "1" } };
    }
    if (method === "Runtime.evaluate") {
      const expression = String(params.expression);
      if (expression === "location.href") return { result: { result: { value: location } } };
      const m = expression.match(/const a = (.*);\n/);
      if (m) fetches.push(JSON.parse(m[1]).url);
      const value = await runInNewContext(expression, {
        location: new URL(location),
        fetch: simulatedFetch,
        AbortSignal,
        URL,
        RegExp,
        String,
      });
      return { result: { result: { value } } };
    }
    return { result: {} };
  };

  // window.fetch in the page, with credentials: same-origin unless CORS.
  const simulatedFetch = async (url: string, init: { method?: string; body?: string } = {}) => {
    const origin = new URL(location).origin;
    let u = new URL(url, location);
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const r = site(u, { method: init.method ?? "GET", body: init.body });
      if (u.origin !== origin && !r?.cors) throw new TypeError("Failed to fetch");
      if (r?.redirect) {
        u = new URL(r.redirect, u);
        continue;
      }
      const status = r ? (r.status ?? 200) : 404;
      return {
        url: u.href,
        status,
        ok: status >= 200 && status < 300,
        statusText: status === 200 ? "OK" : "",
        text: async () => r?.body ?? "",
      };
    }
    throw new TypeError("Failed to fetch");
  };

  return {
    session,
    navigations,
    fetches,
    location: () => location,
    moveTab: (url: string) => {
      location = url;
    },
  };
}
