/**
 * A stand-in for Chrome behind ChromeSession: the real ChromeSession code runs,
 * but its CDP calls are answered by a tiny simulated browser with one tab.
 *
 * - Page.navigate follows `site` redirects (any origin, like a real navigation).
 * - The in-page fetch is same-origin-only, like a fetch with no CORS headers:
 *   a request, or a redirect, to another origin fails with
 *   "TypeError: Failed to fetch".
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ChromeOptions, ChromeSession } from "../src/browser.js";

export interface FakeResponse {
  status?: number;
  body?: string;
  /** Absolute URL to redirect to (302). */
  redirect?: string;
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
      if (!m) throw new Error(`unexpected expression: ${expression.slice(0, 80)}`);
      const a = JSON.parse(m[1]) as { url: string; init: { method: string; body?: string } };
      fetches.push(a.url);
      return { result: { result: { value: inPageFetch(a.url, a.init) } } };
    }
    return { result: {} };
  };

  const inPageFetch = (url: string, init: { method: string; body?: string }) => {
    const origin = new URL(location).origin;
    let u = new URL(url);
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      if (u.origin !== origin) return { error: "TypeError: Failed to fetch" };
      const r = site(u, init);
      if (r?.redirect) {
        u = new URL(r.redirect, u);
        continue;
      }
      const status = r ? (r.status ?? 200) : 404;
      return {
        status,
        ok: status >= 200 && status < 300,
        statusText: status === 200 ? "OK" : "",
        body: r?.body ?? "",
      };
    }
    return { error: "TypeError: Failed to fetch" };
  };

  return { session, navigations, fetches, location: () => location };
}
