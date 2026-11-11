/**
 * Errors that mean "every following request would fail the same way": the
 * site blocks us (DataDome, expired session, landed elsewhere) or Chrome is
 * not usable. A batch (add_many) stops at the first one instead of repeating
 * requests against a blocked site.
 */
export class BlockingError extends Error {
  readonly blocking = true;

  constructor(message: string) {
    super(message);
    this.name = "BlockingError";
  }
}

/**
 * The page came back, but not in the shape this version reads: Leclerc Drive
 * changed something. Said plainly, instead of an empty result that looks like
 * "no product".
 */
export class SiteChangedError extends Error {
  constructor(what: string) {
    super(
      `Leclerc Drive semble avoir changé ${what} : cette version de mcp-leclerc-drive ne sait plus ` +
        `la lire. Mets le serveur à jour ; si c'est déjà la dernière version, signale-le dans une ` +
        `issue du dépôt GitHub lborruto/mcp-leclerc-drive (résultat de l'outil diagnostic à l'appui).`,
    );
    this.name = "SiteChangedError";
  }
}

export function isBlocking(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { blocking?: unknown }).blocking === true;
}
