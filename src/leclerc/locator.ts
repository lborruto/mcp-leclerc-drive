/**
 * Store locator client.
 *
 * Wraps Leclerc's store-finder REST API (reverse-engineered + validated live —
 * see docs/api-capture.md §4) so users can pick their drive by postal code or
 * city instead of knowing their store id and host. Three chained calls:
 *
 *   1. /autocomplete?search=...        → place suggestions (each with an id)
 *   2. /autocomplete/coordinates?id=.. → lat/lng for the chosen place
 *   3. /MapPoint/nearby?lat&lng&cp     → nearby stores (id, name, host, services)
 *
 * Like the rest of the site this API sits behind DataDome, so requests replay
 * the Chrome session cookie and go through the same throttle/retry layer.
 */

import { ChromeSession } from "../browser.js";
import { LeclercConfig } from "../config.js";
import { delay, Throttler } from "./throttle.js";

const API_BASE =
  "https://api-recherchemagasins.leclercdrive.fr/API_RechercheMagasins/api/v1";
/** Page origin the locator fetches run from (CORS-allowed for the locator API). */
const LOCATOR_PAGE = { url: "https://www.leclercdrive.fr/" };
const RETRYABLE_STATUSES = new Set([403, 429]);

export interface FoundStore {
  storeId: string; // noPL
  noPR: string;
  name: string;
  city?: string;
  postalCode?: string;
  /** "drive", "relais" (retrait piéton) or "livraison". */
  serviceType: string;
  distanceKm?: number;
  host: string; // e.g. "fd9-courses.leclercdrive.fr"
}

interface AutocompletePlace {
  id: string;
  postalCode?: string;
  city?: string;
}
interface NearbyPoint {
  noPL?: string | number;
  noPR?: string | number;
  name?: string;
  postalCode?: string;
  serviceType?: string;
  type?: string;
  distance?: number;
  urlSiteCourse?: string;
  urlBase?: string;
}

export class StoreLocator {
  private readonly throttler: Throttler;

  constructor(
    private readonly config: LeclercConfig,
    private readonly browser: ChromeSession,
  ) {
    this.throttler = new Throttler({
      minIntervalMs: config.minIntervalMs,
      jitterMs: config.jitterMs,
      maxRetries: config.maxRetries,
      backoffBaseMs: config.backoffBaseMs,
    });
  }

  /** Search drives by postal code or city, nearest first. */
  async findStores(query: string): Promise<FoundStore[]> {
    const auto = await this.getJson<{ postalCodes?: AutocompletePlace[] }>(
      `${API_BASE}/autocomplete?search=${encodeURIComponent(query)}&provider=Woosmap`,
    );
    const place = auto.postalCodes?.[0];
    if (!place) return [];

    const coords = await this.getJson<{
      latitude?: number;
      longitude?: number;
      coordinates?: { latitude?: number; longitude?: number };
    }>(`${API_BASE}/autocomplete/coordinates?id=${encodeURIComponent(place.id)}&provider=Woosmap`);
    const lat = coords.latitude ?? coords.coordinates?.latitude;
    const lng = coords.longitude ?? coords.coordinates?.longitude;
    if (lat === undefined || lng === undefined) return [];

    const cp = place.postalCode ?? query;
    const near = await this.getJson<{ points?: NearbyPoint[] }>(
      `${API_BASE}/MapPoint/nearby?latitude=${lat}&longitude=${lng}&postalCode=${encodeURIComponent(cp)}`,
    );

    const out: FoundStore[] = [];
    for (const p of near.points ?? []) {
      const host = hostOf(p.urlSiteCourse || p.urlBase);
      if (!host || p.noPL === undefined) continue;
      out.push({
        storeId: String(p.noPL),
        noPR: String(p.noPR ?? p.noPL),
        name: p.name ?? `Magasin ${p.noPL}`,
        city: place.city,
        postalCode: p.postalCode,
        serviceType: (p.serviceType || p.type || "?").toLowerCase(),
        distanceKm: typeof p.distance === "number" ? p.distance : undefined,
        host,
      });
    }
    return out;
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await this.send(url);
    if (!res.ok) throw new Error(`Locator HTTP ${res.status} (${res.statusText})`);
    return res.json() as T;
  }

  /** Throttled GET, run inside the real Chrome (via ChromeSession) so it passes DataDome. */
  private send(url: string): Promise<import("../browser.js").PageResponse> {
    return this.throttler.run(async () => {
      let lastStatus = 0;
      for (let attempt = 0; attempt <= this.throttler.maxRetries; attempt++) {
        if (attempt > 0) await delay(this.throttler.backoff(attempt));
        const res = await this.browser.fetch(LOCATOR_PAGE, url, {
          headers: { Accept: "application/json" },
        });
        if (!RETRYABLE_STATUSES.has(res.status)) return res;
        lastStatus = res.status;
      }
      throw new Error(
        `Localisateur de magasins bloqué (HTTP ${lastStatus}). Vérifie que la fenêtre ` +
          `Chrome du serveur est ouverte, puis réessaie.`,
      );
    });
  }
}

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
