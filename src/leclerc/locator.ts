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
 * Like the rest of the site this API sits behind DataDome, so requests run in
 * the real Chrome and go through the same throttle/retry layer as the store.
 */

import { PageResponse } from "../browser.js";
import { isStoreHost, isStoreId } from "../hosts.js";
import { PageHttp } from "./http.js";

const API_BASE =
  "https://api-recherchemagasins.leclercdrive.fr/API_RechercheMagasins/api/v1";
/** Page origin the locator fetches run from (CORS-allowed for the locator API). */
const LOCATOR_PAGE = { url: "https://www.leclercdrive.fr/" };

export interface FoundStore {
  /**
   * What the user picks with set_store: noPL for a drive, "noPL-noPR" when the
   * retrieval point differs (relays share their drive's noPL), and unique in
   * one result list.
   */
  key: string;
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
  constructor(private readonly http: PageHttp) {}

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
    const keys = new Set<string>();
    for (const p of near.points ?? []) {
      // Only stores on a known shopping host, with plain numeric ids, are kept:
      // everything here ends up in URLs.
      const host = hostOf(p.urlSiteCourse || p.urlBase);
      if (!isStoreHost(host) || p.noPL === undefined || !isStoreId(String(p.noPL))) continue;
      if (p.noPR !== undefined && !isStoreId(String(p.noPR))) continue;
      const storeId = String(p.noPL);
      const noPR = String(p.noPR ?? p.noPL);
      let key = noPR === storeId ? storeId : `${storeId}-${noPR}`;
      for (let n = 2; keys.has(key); n++) key = `${noPR === storeId ? storeId : `${storeId}-${noPR}`}-${n}`;
      keys.add(key);
      out.push({
        key,
        storeId,
        noPR,
        name: (p.name ?? `Magasin ${p.noPL}`).trim(),
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

  /** Throttled, retried GET, run from a www.leclercdrive.fr page (see http.ts). */
  private send(url: string): Promise<PageResponse> {
    return this.http.request(() => LOCATOR_PAGE, url, {
      headers: { Accept: "application/json" },
      blockedMessage: (status) =>
        `Localisateur de magasins bloqué (HTTP ${status}). Vérifie que la fenêtre Chrome du ` +
        `serveur est ouverte, puis réessaie.`,
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
