/**
 * Like `Promise.all(items.map(fn))` but runs at most `limit` calls of `fn`
 * concurrently. Prevents unbounded fan-out (e.g. thousands of simultaneous
 * fs.promises.readFile calls hitting EMFILE). Results are returned in input order.
 * 
 * Funtion is fail-fast: on the first rejection, other
 * in-flight items still complete but the results are discarded. If a caller ever uses
 * it for batch *writes* (multi-file paste, search-and-replace), a mid-batch failure
 * leaves a partially applied batch with no report of which items completed. Fine as a
 *  read helper; callers doing writes need their own per-item accounting.
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
  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, worker));
  return results;
}
