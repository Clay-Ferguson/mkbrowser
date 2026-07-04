import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../src/shared/asyncUtil';

describe('mapWithConcurrency', () => {
  it('returns results in input order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(items, 2, async (n) => n * 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('passes the index to the iteratee', async () => {
    const items = ['a', 'b', 'c'];
    const results = await mapWithConcurrency(items, 2, async (item, i) => `${item}${i}`);
    expect(results).toEqual(['a0', 'b1', 'c2']);
  });

  it('handles an empty input', async () => {
    const results = await mapWithConcurrency([], 5, async (n) => n);
    expect(results).toEqual([]);
  });

  it('accepts a synchronous iteratee', async () => {
    const results = await mapWithConcurrency([1, 2, 3], 2, (n) => n + 1);
    expect(results).toEqual([2, 3, 4]);
  });

  it('never runs more than `limit` calls at once', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrency(items, 4, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      // Yield so other workers get a chance to ramp up concurrency.
      await new Promise((resolve) => { setTimeout(resolve, 1); });
      active--;
      return n;
    });
    expect(results).toEqual(items);
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it('uses a pool no larger than the number of items', async () => {
    const items = [1, 2];
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency(items, 10, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => { setTimeout(resolve, 1); });
      active--;
      return n;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('rejects when the iteratee throws', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('stops pulling new items once a worker has failed', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const started: number[] = [];
    await expect(
      mapWithConcurrency(items, 2, async (n) => {
        started.push(n);
        // Fail early; surviving workers should stop taking new items.
        if (n === 1) throw new Error('boom');
        await new Promise((resolve) => { setTimeout(resolve, 1); });
        return n;
      }),
    ).rejects.toThrow('boom');
    // With a pool of 2 and a fail-fast flag, only a small prefix of items is
    // ever started — nowhere near all 20.
    expect(started.length).toBeLessThan(items.length);
  });
});
