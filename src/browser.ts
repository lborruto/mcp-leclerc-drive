/**
 * ChromeSession — runs HTTP requests inside a real Chrome via the Chrome
 * DevTools Protocol (CDP), so they carry a genuine browser fingerprint and
 * execute DataDome's JS challenge. This is what lets the tool survive DataDome's
 * "active" mode, which blocks headless clients and cookie-replay (HTTP 403)
 * while letting a real browser through.
 *
 * How it works:
 *  - launches the user's installed Chrome with a *persistent, dedicated* profile
 *    and a debug port, and NO automation flags (navigator.webdriver stays false);
 *  - connects over CDP with Node's built-in WebSocket — no external dependency;
 *  - `fetch()` navigates a page to the right origin (once, then reused) and runs
 *    `window.fetch` in that page's context via Runtime.evaluate. Cookies, TLS
 *    fingerprint and the solved DataDome challenge all come for free.
 *
 * The user logs into Leclerc Drive once in the window; the persistent profile
 * keeps the session across restarts.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";

import { assertNotMainProfile, foreignChromeReason, writeLock } from "./chrome-profile.js";
import { assertAllowedUrl } from "./hosts.js";

export interface PageResponse {
  /** URL of the page the fetch ran from (where navigation actually landed). */
  pageUrl: string;
  status: number;
  ok: boolean;
  statusText: string;
  text(): string;
  json(): unknown;
}

/**
 * The page a fetch must run from. `accept` decides whether the page the tab is
 * already on (or has just landed on, after redirects) will do; by default, any
 * page on `url`'s origin.
 */
export interface PageTarget {
  url: string;
  accept?: (landed: URL) => boolean;
  /** Appended to the error when the tab lands somewhere `accept` refuses. */
  mismatchHint?: string;
}

export interface ChromeOptions {
  /** Path to the Chrome binary; auto-detected per-OS when omitted. */
  chromePath?: string;
  /** Persistent user-data-dir so the Leclerc login survives restarts. */
  profileDir: string;
  /** Remote debugging port. */
  port: number;
  /** Headless is detectable by DataDome — default false (a window opens). */
  headless: boolean;
  /** Pause after each navigation so DataDome's JS challenge can resolve, in ms. */
  settleMs?: number;
}

const DEFAULT_CHROME: Record<string, string> = {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "google-chrome",
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
};

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Longest wait for any CDP command. */
const CDP_TIMEOUT_MS = 60_000;
/** Longest wait for an in-page fetch, aborted in the page itself (below the CDP timeout). */
const FETCH_TIMEOUT_MS = 45_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

async function tryJson(url: string, method = "GET"): Promise<Any> {
  try {
    const r = await fetch(url, { method });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** An in-page fetch that threw (network error, CORS, cross-origin redirect…). */
export class BrowserFetchError extends Error {
  /** Chrome's opaque "TypeError: Failed to fetch": CORS, a cross-origin redirect, the network. */
  readonly failedToFetch: boolean;

  constructor(detail: string) {
    super(`Requête via le navigateur échouée: ${detail}`);
    this.name = "BrowserFetchError";
    this.failedToFetch = /Failed to fetch/i.test(detail);
  }
}

function parseUrl(u: string): URL | null {
  try {
    return new URL(u);
  } catch {
    return null;
  }
}

export class ChromeSession {
  private ws?: Any;
  private msgId = 0;
  private readonly pending = new Map<number, { res: (m: Any) => void; rej: (e: Error) => void }>();
  private eventWaiters: Array<{ method: string; res: () => void }> = [];
  /** Where the tab actually is, read from the page after each navigation. */
  private landedUrl = "";
  private launching?: Promise<void>;

  constructor(private readonly opts: ChromeOptions) {}

  private chromeBinary(): string {
    return this.opts.chromePath || DEFAULT_CHROME[platform()] || "google-chrome";
  }

  private async ensureLaunched(): Promise<void> {
    if (this.ws && this.ws.readyState === 1) return;
    if (!this.launching) {
      this.launching = this.launch().finally(() => {
        this.launching = undefined;
      });
    }
    return this.launching;
  }

  private async launch(): Promise<void> {
    const { port, profileDir } = this.opts;
    const base = `http://127.0.0.1:${port}`;
    assertNotMainProfile(profileDir, platform(), homedir(), process.env);

    // Reuse a debug Chrome on this port only if this server started it, on
    // this profile (see chrome-profile.ts). Anything else is left alone.
    let version = await tryJson(`${base}/json/version`);
    if (version) {
      const reason = foreignChromeReason(profileDir, port);
      if (reason) {
        throw new Error(
          `Un programme écoute déjà sur 127.0.0.1:${port}, mais ce n'est pas le Chrome lancé par ` +
            `mcp-leclerc-drive (${reason}). Par sécurité, le serveur ne s'y connecte pas. Ferme-le, ` +
            `ou choisis un autre port avec LECLERC_CHROME_PORT.`,
        );
      }
    } else {
      mkdirSync(profileDir, { recursive: true });
      const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ];
      if (this.opts.headless) args.unshift("--headless=new");
      const child = spawn(this.chromeBinary(), args, { detached: true, stdio: "ignore" });
      let spawnError: Error | undefined;
      child.on("error", (err) => (spawnError = err));
      child.unref();
      for (let i = 0; i < 40 && !version && !spawnError; i++) {
        await delay(500);
        version = await tryJson(`${base}/json/version`);
      }
      if (!version || !child.pid) {
        throw new Error(
          `Chrome ne démarre pas sur le port ${port}. Vérifie que Google Chrome est installé (ou ` +
            `définis LECLERC_CHROME_PATH), et qu'aucune fenêtre n'est déjà ouverte sur le profil ` +
            `${profileDir} sans le serveur.` +
            (spawnError ? ` (${spawnError.message})` : ""),
        );
      }
      writeLock(profileDir, child.pid, port);
    }

    let targets: Any[] = (await tryJson(`${base}/json/list`)) || [];
    let page = targets.find((t) => t.type === "page");
    if (!page) page = await tryJson(`${base}/json/new`, "PUT");
    if (!page?.webSocketDebuggerUrl) {
      throw new Error("Impossible d'ouvrir un onglet CDP dans Chrome.");
    }

    const WS: Any = (globalThis as Any).WebSocket;
    const ws = new WS(page.webSocketDebuggerUrl);
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = () => rej(new Error("Connexion CDP échouée."));
    });
    ws.onmessage = (e: Any) => {
      const m = JSON.parse(String(e.data));
      const waiter = m.id ? this.pending.get(m.id) : undefined;
      if (waiter) {
        this.pending.delete(m.id);
        if (m.error) waiter.rej(new Error(`Chrome a refusé la commande : ${m.error.message ?? "erreur CDP"}`));
        else waiter.res(m);
      } else if (m.method) {
        this.eventWaiters = this.eventWaiters.filter((w) => {
          if (w.method === m.method) {
            w.res();
            return false;
          }
          return true;
        });
      }
    };
    // The window was closed, Chrome quit or crashed: fail what is in flight and
    // start over (relaunch, re-navigate) on the next request.
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.landedUrl = "";
      const lost = new Error(
        "La connexion à Chrome a été perdue (fenêtre fermée ?). Réessaie : le serveur relancera Chrome.",
      );
      for (const w of this.pending.values()) w.rej(lost);
      this.pending.clear();
    };
    this.ws = ws;
    await this.cdp("Page.enable");
    this.landedUrl = page.url || "";
  }

  /** Send one CDP command; rejects on a CDP error, a lost connection or a timeout. */
  private cdp(method: string, params: Any = {}, timeoutMs = CDP_TIMEOUT_MS): Promise<Any> {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) {
      return Promise.reject(new Error("Chrome n'est pas connecté. Réessaie : le serveur le relancera."));
    }
    const id = ++this.msgId;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`Chrome ne répond pas (${method}, ${timeoutMs / 1000} s).`));
      }, timeoutMs);
      this.pending.set(id, {
        res: (m) => {
          clearTimeout(timer);
          res(m);
        },
        rej: (e) => {
          clearTimeout(timer);
          rej(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  private waitEvent(method: string, timeoutMs = 20000): Promise<void> {
    return new Promise<void>((res) => {
      const w = { method, res: () => res() };
      this.eventWaiters.push(w);
      setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter((x) => x !== w);
        res();
      }, timeoutMs);
    });
  }

  /**
   * Make sure the tab sits on a page `target` accepts, navigating to
   * `target.url` if needed. The page's real URL is read back after the
   * navigation: hosts may redirect (e.g. a generic fd1-courses host 302s to the
   * store's own shard), and fetches must stay same-origin with where the page
   * landed, not with where it was sent.
   */
  private async ensurePage(target: PageTarget): Promise<URL> {
    const targetOrigin = assertAllowedUrl(target.url).origin;
    const accept = target.accept ?? ((landed: URL) => landed.origin === targetOrigin);
    const current = parseUrl(this.landedUrl);
    if (current && accept(current)) return current;

    const loaded = this.waitEvent("Page.loadEventFired");
    const nav = await this.cdp("Page.navigate", { url: target.url });
    if (nav.result?.errorText) {
      throw new Error(`Chrome n'a pas pu ouvrir ${target.url} (${nav.result.errorText}).`);
    }
    await loaded;
    await delay(this.opts.settleMs ?? 1800); // let the DataDome JS challenge resolve
    this.landedUrl = await this.locationHref();

    const landed = parseUrl(this.landedUrl);
    if (landed) {
      try {
        assertAllowedUrl(landed);
      } catch {
        this.landedUrl = "";
        throw new Error(
          `La page a été redirigée hors de Leclerc Drive (${landed.host}) : le serveur s'arrête là.`,
        );
      }
    }
    if (!landed || !accept(landed)) {
      throw new Error(
        `La page Leclerc Drive a atterri sur ${landed ? landed.origin + landed.pathname : "une page vide"} ` +
          `au lieu de ${target.url}.` +
          (target.mismatchHint ? ` ${target.mismatchHint}` : ""),
      );
    }
    return landed;
  }

  /** Forget where the tab is, so the next fetch navigates again. */
  invalidatePage(): void {
    this.landedUrl = "";
  }

  /** The tab's real URL, as the page itself reports it. */
  private async locationHref(): Promise<string> {
    const r = await this.cdp("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    return String(r.result?.result?.value ?? "");
  }

  /**
   * Run `fetch(url, opts)` inside a page `page` accepts. `url` may be relative:
   * it is resolved against the page the tab actually landed on, so a redirect to
   * another shard keeps requests same-origin. The page's cookies, UA and solved
   * DataDome challenge apply automatically, so do NOT set Cookie/User-Agent in
   * `opts.headers`.
   */
  async fetch(
    page: PageTarget,
    url: string,
    opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<PageResponse> {
    await this.ensureLaunched();
    const landed = await this.ensurePage(page);

    const args = {
      url: assertAllowedUrl(new URL(url, landed)).href,
      init: {
        method: opts.method || "GET",
        headers: opts.headers || {},
        body: opts.body,
        credentials: "include",
      },
    };
    const expression = `(async () => {
      const a = ${JSON.stringify(args)};
      try {
        a.init.signal = AbortSignal.timeout(${FETCH_TIMEOUT_MS});
        const r = await fetch(a.url, a.init);
        const t = await r.text();
        return { status: r.status, ok: r.ok, statusText: r.statusText, body: t };
      } catch (e) { return { error: String(e) }; }
    })()`;

    const r = await this.cdp("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const v = r.result?.result?.value;
    if (!v || v.error) {
      const detail = v?.error || r.result?.exceptionDetails?.text || "erreur inconnue";
      throw new BrowserFetchError(String(detail));
    }
    return {
      pageUrl: landed.href,
      status: v.status,
      ok: v.ok,
      statusText: v.statusText,
      text: () => v.body,
      json: () => JSON.parse(v.body),
    };
  }

  async close(): Promise<void> {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
