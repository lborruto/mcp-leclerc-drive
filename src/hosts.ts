/**
 * The only hosts this server ever talks to (besides Chrome on 127.0.0.1).
 * Checked before every navigation and every fetch, on the URL the page
 * actually landed on, and on every host that comes from outside the code:
 * set_store, LECLERC_HOST, the saved store selection, the store locator.
 *
 * Store pages are served from numbered shards: `fdN-courses.leclercdrive.fr`
 * (shopping) and its `fdN-secure` twin (account/session).
 */

const ALLOWED_HOSTS: RegExp[] = [
  /^fd\d+-(courses|secure)\.leclercdrive\.fr$/,
  /^www\.leclercdrive\.fr$/,
  /^api-recherchemagasins\.leclercdrive\.fr$/,
];

const STORE_HOST = /^fd\d+-courses\.leclercdrive\.fr$/;

/** Store ids (noPL / noPR) are digit strings, e.g. "053701". */
const STORE_ID = /^\d{1,10}$/;

export function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.some((re) => re.test(host));
}

/** True for a store shopping host, e.g. "fd10-courses.leclercdrive.fr". */
export function isStoreHost(host: string): boolean {
  return STORE_HOST.test(host);
}

export function isStoreId(id: string): boolean {
  return STORE_ID.test(id);
}

/**
 * Parse `url` and refuse anything but https on an allow-listed host, with no
 * explicit port and no credentials.
 */
export function assertAllowedUrl(url: string | URL): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`URL invalide : ${String(url)}`);
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username !== "" || u.password !== "" || !isAllowedHost(u.hostname)) {
    throw new Error(
      `Accès refusé à ${u.protocol}//${u.host} : seuls les sites Leclerc Drive autorisés sont contactés.`,
    );
  }
  return u;
}

/**
 * Normalize a store host given by a user or a config file: a bare host
 * ("fd9-courses.leclercdrive.fr") or a URL on it. Only store shopping hosts
 * are accepted.
 */
export function parseStoreHost(input: string): string {
  const raw = input.trim().toLowerCase();
  let host = raw;
  if (raw.includes("/")) {
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" || u.port || u.username || u.password) host = "";
      else host = u.hostname;
    } catch {
      host = "";
    }
  }
  if (!isStoreHost(host)) {
    throw new Error(
      `Hôte de magasin invalide : « ${input} ». Attendu : fdN-courses.leclercdrive.fr ` +
        `(utilise find_stores pour le trouver).`,
    );
  }
  return host;
}
