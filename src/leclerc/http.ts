/**
 * The one way requests reach Leclerc Drive: serialized and spaced out by a
 * single Throttler shared by the store client and the locator (DataDome reacts
 * to bursts, whoever sends them), run inside the real Chrome, and retried:
 *
 *  - HTTP 403/429 (DataDome challenge, rate limit): retried with backoff.
 *  - "Failed to fetch" (issue #2): after an idle period the store host may
 *    answer with a redirect to its fdN-secure twin, which an in-page fetch
 *    cannot follow. The page is navigated to the store again (a top-level
 *    navigation follows the redirect and restores the session), then the
 *    request is retried once.
 */

import { BrowserFetchError, ChromeSession, PageResponse, PageTarget } from "../browser.js";
import { delay, Throttler } from "./throttle.js";

/** HTTP statuses that indicate a DataDome challenge / rate-limit worth retrying. */
const RETRYABLE_STATUSES = new Set([403, 429]);

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Error message once 403/429 retries are exhausted. */
  blockedMessage: (status: number) => string;
  /** Called with every response, before the status is looked at. */
  onResponse?: (res: PageResponse) => void;
}

export class PageHttp {
  constructor(
    private readonly browser: ChromeSession,
    private readonly throttler: Throttler,
  ) {}

  /**
   * `page` is called before each attempt, so a store selection that changed in
   * between (e.g. a corrected host) is picked up.
   */
  request(page: () => PageTarget, url: string, opts: RequestOptions): Promise<PageResponse> {
    return this.throttler.run(async () => {
      let lastStatus = 0;
      let renavigated = false;
      for (let attempt = 0; attempt <= this.throttler.maxRetries; attempt++) {
        if (attempt > 0) await delay(this.throttler.backoff(attempt));
        let res: PageResponse;
        try {
          res = await this.browser.fetch(page(), url, {
            method: opts.method ?? "GET",
            headers: opts.headers,
            body: opts.body,
          });
        } catch (err) {
          if (err instanceof BrowserFetchError && err.failedToFetch && !renavigated) {
            renavigated = true;
            this.browser.invalidatePage();
            attempt--; // a fresh navigation, not a 403/429 retry
            continue;
          }
          throw err;
        }
        opts.onResponse?.(res);
        if (!RETRYABLE_STATUSES.has(res.status)) return res;
        lastStatus = res.status;
      }
      throw new Error(opts.blockedMessage(lastStatus));
    });
  }
}
