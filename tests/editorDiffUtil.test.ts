import { describe, it, expect } from 'vitest';
import { minimalDiff } from '../src/renderer/editor/editorDiffUtil';

/**
 * Applies the single replacement returned by minimalDiff to `old`, the same way a
 * CodeMirror dispatch would. Every test can then assert the invariant that matters:
 * applying the diff always reproduces `next` exactly.
 */
function applyDiff(old: string, d: { from: number; to: number; insert: string }): string {
  return old.slice(0, d.from) + d.insert + old.slice(d.to);
}

/** Asserts the round-trip invariant and returns the diff for shape assertions. */
function diffAndVerify(old: string, next: string): { from: number; to: number; insert: string } {
  const d = minimalDiff(old, next);
  expect(applyDiff(old, d)).toBe(next);
  expect(d.from).toBeGreaterThanOrEqual(0);
  expect(d.to).toBeGreaterThanOrEqual(d.from);
  expect(d.to).toBeLessThanOrEqual(old.length);
  return d;
}

describe('minimalDiff', () => {
  it('returns a no-op change for identical strings', () => {
    const d = diffAndVerify('hello world', 'hello world');
    expect(d.insert).toBe('');
    expect(d.from).toBe(d.to);
  });

  it('returns a no-op change for two empty strings', () => {
    const d = diffAndVerify('', '');
    expect(d).toEqual({ from: 0, to: 0, insert: '' });
  });

  it('handles insertion into an empty document', () => {
    const d = diffAndVerify('', 'new content');
    expect(d).toEqual({ from: 0, to: 0, insert: 'new content' });
  });

  it('handles deletion of the whole document', () => {
    const d = diffAndVerify('old content', '');
    expect(d).toEqual({ from: 0, to: 11, insert: '' });
  });

  it('localizes a mid-string edit to the changed region only', () => {
    // The external-sync scenario the fix exists for: a small edit deep in a large
    // document must not produce a whole-document replacement.
    const before = 'line one\nline two\n- [ ] task\nline four\n';
    const after = 'line one\nline two\n- [x] task\nline four\n';
    const d = diffAndVerify(before, after);
    expect(d).toEqual({ from: 21, to: 22, insert: 'x' });
  });

  it('localizes an edit at the start of the string', () => {
    const d = diffAndVerify('abc shared tail', 'xyz shared tail');
    expect(d).toEqual({ from: 0, to: 3, insert: 'xyz' });
  });

  it('localizes an edit at the end of the string', () => {
    const d = diffAndVerify('shared head abc', 'shared head xyz');
    expect(d).toEqual({ from: 12, to: 15, insert: 'xyz' });
  });

  it('handles pure insertion in the middle', () => {
    const d = diffAndVerify('ab', 'aXb');
    expect(d).toEqual({ from: 1, to: 1, insert: 'X' });
  });

  it('handles pure deletion in the middle', () => {
    const d = diffAndVerify('aXb', 'ab');
    expect(d).toEqual({ from: 1, to: 2, insert: '' });
  });

  it('does not overlap prefix and suffix on repeated characters', () => {
    // "aa" -> "aaa": prefix scan consumes both a's; the suffix scan must be capped
    // so the shared run is not double-counted.
    const d = diffAndVerify('aa', 'aaa');
    expect(d.insert).toBe('a');
    expect(d.to - d.from).toBe(0);
  });

  it('does not overlap prefix and suffix when shrinking repeated characters', () => {
    const d = diffAndVerify('aaa', 'aa');
    expect(d.insert).toBe('');
    expect(d.to - d.from).toBe(1);
  });

  it('handles completely different strings as one full replacement', () => {
    const d = diffAndVerify('abc', 'xyz');
    expect(d).toEqual({ from: 0, to: 3, insert: 'xyz' });
  });

  it('keeps the shared prefix and suffix out of the replacement (AI-rewrite shape)', () => {
    const before = '# Title\n\nSome middle paragraph here.\n\n## Footer\n';
    const after = '# Title\n\nA rewritten middle paragraph.\n\n## Footer\n';
    const d = diffAndVerify(before, after);
    expect(d.from).toBe('# Title\n\n'.length);
    // The scan is greedy, so the preserved suffix also captures the paragraphs'
    // shared trailing period.
    expect(before.slice(d.to)).toBe('.\n\n## Footer\n');
  });

  it('round-trips multi-byte / surrogate-pair content', () => {
    diffAndVerify('before 😀 after', 'before 😁 after');
    diffAndVerify('café', 'cafe');
    diffAndVerify('naïve — text', 'naïve → text');
  });

  it('round-trips randomized edits (fuzz)', () => {
    // Deterministic LCG so failures are reproducible.
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % n;
    };
    const alphabet = 'ab\ncd';
    const randomString = (len: number) => Array.from({ length: len }, () => alphabet[rand(alphabet.length)]).join('');
    for (let i = 0; i < 500; i++) {
      const old = randomString(rand(40));
      const next = randomString(rand(40));
      diffAndVerify(old, next);
    }
  });
});
