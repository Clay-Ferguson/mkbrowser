/** Normalizes a thrown value into a human-readable error message. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
