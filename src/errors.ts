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

export function isBlocking(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { blocking?: unknown }).blocking === true;
}
