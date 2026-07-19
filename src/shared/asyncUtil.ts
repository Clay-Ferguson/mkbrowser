/**
 * Like `Promise.all(items.map(fn))` but runs at most `limit` calls of `fn`
 * concurrently. Prevents unbounded fan-out (e.g. thousands of simultaneous
 * fs.promises.readFile calls hitting EMFILE). Results are returned in input order.
 * 
 * Fail-fast: on the first rejection, other in-flight items still complete but
 * the results are discarded. If a caller ever uses it for batch *writes*
 * (multi-file paste, search-and-replace), a mid-batch failure leaves a partially
 * applied batch with no report of which items completed. Fine as a read helper;
 * callers doing writes need their own per-item accounting.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    // Stop pulling new items once any worker has rejected, so a fail-fast
    // rejection doesn't leave surviving workers firing off background tasks.
    while (next < items.length && !failed) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  // Clamp the pool size defensively. Two hazards conspire here:
  //  1. Math.min/Math.max PROPAGATE NaN rather than ignoring it, so a NaN
  //     `limit` (bad caller arithmetic, or `undefined` slipping past the types
  //     from an untyped call site) would make the pool size NaN.
  //  2. Array.from({ length: NaN }) silently yields an EMPTY array — a NaN
  //     pool size would spawn ZERO workers, and this function would resolve
  //     successfully to an array of holes without calling `fn` even once.
  // The `>= 1 ? : 1` form is deliberate: NaN compares false to everything, so
  // any non-numeric/zero/negative limit falls through to a serial (size-1)
  // pool, which still maps every item — degraded concurrency, never silently
  // skipped work. (Infinity is fine: Math.min bounds it to items.length.)
  const bounded = Math.min(limit, items.length);
  const poolSize = bounded >= 1 ? bounded : 1;
  await Promise.all(Array.from({ length: poolSize }, worker));
  return results;
}
