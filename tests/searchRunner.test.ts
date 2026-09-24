/**
 * Tests for createExclusiveSearchRunner (src/main/searchRunner.ts): starting a
 * search cancels the one in progress and waits for it to stop first.
 */
import { describe, it, expect } from 'vitest';
import { createExclusiveSearchRunner, SearchCancelledError } from '../src/main/searchRunner';

/** A search body that runs until its signal aborts, then rejects with the reason. */
function untilAborted(log: string[], name: string) {
  return (signal: AbortSignal) => {
    log.push(`${name} started`);
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        // Stop asynchronously, like a real search reaching its next checkpoint.
        setTimeout(() => {
          log.push(`${name} stopped`);
          reject(signal.reason);
        }, 5);
      });
    });
  };
}

describe('createExclusiveSearchRunner', () => {
  it('runs a lone search to completion', async () => {
    const run = createExclusiveSearchRunner();
    await expect(run(async () => 'done')).resolves.toBe('done');
  });

  it('a new search cancels the running one and starts only after it stopped', async () => {
    const run = createExclusiveSearchRunner();
    const log: string[] = [];
    const first = run(untilAborted(log, 'A'));
    const second = run(async () => {
      log.push('B started');
      return 'B result';
    });

    await expect(first).rejects.toBeInstanceOf(SearchCancelledError);
    await expect(second).resolves.toBe('B result');
    expect(log).toEqual(['A started', 'A stopped', 'B started']);
  });

  it('in a burst, only the last search runs; the middle one never starts', async () => {
    const run = createExclusiveSearchRunner();
    const log: string[] = [];
    const a = run(untilAborted(log, 'A'));
    const b = run(async () => { log.push('B started'); return 'B'; });
    const c = run(async () => { log.push('C started'); return 'C'; });

    await expect(a).rejects.toBeInstanceOf(SearchCancelledError);
    await expect(b).rejects.toBeInstanceOf(SearchCancelledError);
    await expect(c).resolves.toBe('C');
    expect(log).toEqual(['A started', 'A stopped', 'C started']);
  });

  it("a failed search's error goes to its own caller, not the next search", async () => {
    const run = createExclusiveSearchRunner();
    await expect(run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(run(async () => 'ok')).resolves.toBe('ok');
  });

  it('a search that already finished is not cancelled by the next one', async () => {
    const run = createExclusiveSearchRunner();
    let firstSignal: AbortSignal | undefined;
    await run(async (signal) => { firstSignal = signal; return 1; });
    await run(async () => 2);
    expect(firstSignal?.aborted).toBe(false);
  });
});
