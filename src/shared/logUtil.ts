/**
 * Thin wrapper around the console so call sites import `logger` instead of
 * referencing `console` directly. This lets us suppress the ESLint `no-console`
 * rule in one place and makes it trivial to swap in a real logging library later.
 */
export const logger = {
    // eslint-disable-next-line no-console
    log: (...args: unknown[]) => console.log(...args),
    // eslint-disable-next-line no-console
    warn: (...args: unknown[]) => console.warn(...args),
    // eslint-disable-next-line no-console
    error: (...args: unknown[]) => console.error(...args),
    // eslint-disable-next-line no-console
    info: (...args: unknown[]) => console.info(...args),
    // eslint-disable-next-line no-console
    debug: (...args: unknown[]) => console.debug(...args),
};

/** Normalizes a thrown value into a human-readable error message. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
