/**
 * Runs folder searches one at a time, newest wins: starting a search cancels
 * the one in progress (if any) and waits for it to stop before the new one
 * begins, so two searches never compete for the main process.
 */

/** The reason a search is aborted when a newer search replaces it. */
export class SearchCancelledError extends Error {
  constructor() {
    super('Search cancelled because a newer search started');
    this.name = 'SearchCancelledError';
  }
}

/**
 * Creates an exclusive runner. Each call to the returned function:
 *  1. aborts the previous search (with a SearchCancelledError reason),
 *  2. waits for that search to settle,
 *  3. then runs `run` with a fresh AbortSignal — unless a still newer search
 *     arrived in the meantime, in which case this one is cancelled before it
 *     starts.
 *
 * Each call registers itself as the latest BEFORE waiting, so a burst of
 * requests forms a chain: every request only waits for the one just before it,
 * and only the last one actually runs to completion.
 */
export function createExclusiveSearchRunner(): <T>(run: (signal: AbortSignal) => Promise<T>) => Promise<T> {
  let latest: { controller: AbortController; done: Promise<unknown> } | null = null;

  return <T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const previous = latest;
    const controller = new AbortController();
    const entry: { controller: AbortController; done: Promise<unknown> } = { controller, done: Promise.resolve() };
    const done = (async () => {
      try {
        if (previous) {
          previous.controller.abort(new SearchCancelledError());
          // Only waiting for it to stop — its result or error belongs to its own caller.
          await previous.done.catch(() => undefined);
        }
        controller.signal.throwIfAborted();
        return await run(controller.signal);
      } finally {
        // Forget this search once it has settled (before its caller sees the
        // result), unless a newer one has already replaced it — so a search
        // started afterwards never aborts one that already finished.
        if (latest === entry) latest = null;
      }
    })();
    entry.done = done;
    latest = entry;
    return done;
  };
}
