/**
 * Leclerc Drive host names.
 *
 * Store pages are served from numbered shards: `fdN-courses.leclercdrive.fr`
 * (shopping) and its `fdN-secure` twin (account/session).
 */

const STORE_HOST = /^fd\d+-courses\.leclercdrive\.fr$/;

/** True for a store shopping host, e.g. "fd10-courses.leclercdrive.fr". */
export function isStoreHost(host: string): boolean {
  return STORE_HOST.test(host);
}
