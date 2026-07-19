/**
 * Tests for the sandboxed advanced-query evaluator (src/main/advancedQuery.ts).
 * Focus: the sandbox blocks all paths to Node/fs, the timeout fires, and the
 * helper bridge preserves values (including NaN and nested YAML objects).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { compileAdvancedQuery, AdvancedQueryTimeoutError, AdvancedQueryHost } from '../src/main/advancedQuery';

/** Host whose $ matches when content includes the text; prop reads from a map. */
function makeHost(content = '', props: Record<string, unknown> = {}): AdvancedQueryHost {
  return {
    $: (t) => content.includes(t),
    prop: (path, valType) => (valType === 'ts' ? Number.NaN : props[path]),
    past: (ts) => !Number.isNaN(ts) && ts < Date.now(),
    future: (ts) => !Number.isNaN(ts) && ts > Date.now(),
    today: (ts) => !Number.isNaN(ts),
  };
}

function evalQuery(query: string, host = makeHost()): boolean {
  return compileAdvancedQuery(query)(host);
}

describe('sandbox containment', () => {
  it.each([
    'typeof process === "undefined"',
    'typeof require === "undefined"',
    'typeof globalThis.process === "undefined"',
    // Classic vm escape: reach the host Function constructor via a constructor walk.
    '(() => { try { return this.constructor.constructor("return typeof process")() === "undefined"; } catch { return true; } })()',
    // Function/eval exist but belong to the empty sandbox realm.
    'new Function("return typeof process")() === "undefined"',
    'eval("typeof require") === "undefined"',
    // The helpers are sandbox-realm wrappers; their .constructor leads nowhere useful.
    '$.constructor("return typeof process")() === "undefined"',
    // Thrown host errors cross as primitives, not host Error objects.
    '(() => { try { prop({ toString() { throw 1; } }); return true; } catch (e) { return typeof e !== "object"; } })()',
  ])('%s', (query) => {
    expect(evalQuery(query)).toBe(true);
  });

  it('a query that tries to write a file throws and no file is created', () => {
    const target = path.join(os.tmpdir(), `advancedQuery-escape-${process.pid}.txt`);
    // Every route to a write: require, process.binding, and the dynamic-import
    // escape (import() is blocked in vm scripts without an importer callback).
    const run = compileAdvancedQuery(
      `(require('fs').writeFileSync(${JSON.stringify(target)}, 'pwned'), true)`,
    );
    expect(() => run(makeHost())).toThrow(/require is not defined/);
    // Dynamic import doesn't throw synchronously — it returns a rejected promise
    // (vm scripts get no import callback). The .then handlers run inside the
    // evaluation (microtaskMode: 'afterEvaluate'), so a second evaluation of the
    // same query observes the recorded outcome via the persistent context global.
    const runImport = compileAdvancedQuery(`(globalThis.state === undefined
      ? (globalThis.state = 'pending',
         import('node:fs').then(
           (m) => { globalThis.state = 'loaded'; m.writeFileSync(${JSON.stringify(target)}, 'pwned'); },
           () => { globalThis.state = 'rejected'; }),
         false)
      : globalThis.state === 'rejected')`);
    expect(runImport(makeHost())).toBe(false);
    expect(runImport(makeHost())).toBe(true); // import rejected — fs never loaded
    expect(fs.existsSync(target)).toBe(false);
  });

  it('helpers cannot be overwritten from the query', () => {
    // Non-writable global: sloppy-mode assignment is a silent no-op.
    expect(evalQuery('($ = () => true, $("nope"))', makeHost('content'))).toBe(false);
  });
});

describe('timeout', () => {
  it('throws AdvancedQueryTimeoutError on an infinite loop', () => {
    const run = compileAdvancedQuery('(() => { while (true) {} })()');
    expect(() => run(makeHost())).toThrow(AdvancedQueryTimeoutError);
  });

  it('throws on an infinite loop hidden in a microtask', () => {
    const run = compileAdvancedQuery('(Promise.resolve().then(() => { while (true) {} }), true)');
    expect(() => run(makeHost())).toThrow(AdvancedQueryTimeoutError);
  });
});

describe('helper bridge', () => {
  it('$ matches and respects boolean logic', () => {
    const host = makeHost('the quick brown fox');
    expect(evalQuery("$('quick') && !$('zebra')", host)).toBe(true);
    expect(evalQuery("$('zebra') || $('fox')", host)).toBe(true);
    expect(evalQuery("$('zebra')", host)).toBe(false);
  });

  it('prop returns primitives, nested objects, and arrays intact', () => {
    const host = makeHost('', { title: 'Notes', count: 3, tags: ['a', 'b'], meta: { deep: { x: 1 } } });
    expect(evalQuery("prop('title') === 'Notes'", host)).toBe(true);
    expect(evalQuery("prop('count') === 3", host)).toBe(true);
    expect(evalQuery("prop('tags').includes('b')", host)).toBe(true);
    expect(evalQuery("prop('meta').deep.x === 1", host)).toBe(true);
    expect(evalQuery("prop('missing') === undefined", host)).toBe(true);
  });

  it('prop(…, "ts") NaN sentinel survives the boundary (not corrupted to null)', () => {
    expect(evalQuery("Number.isNaN(prop('due', 'ts'))", makeHost())).toBe(true);
    expect(evalQuery("past(prop('due', 'ts'))", makeHost())).toBe(false);
  });

  it('past/future receive numbers and return booleans', () => {
    expect(evalQuery('past(1)')).toBe(true);
    expect(evalQuery('future(Date.now() + 1e6)')).toBe(true);
  });

  it('today crosses the bridge: valid timestamp true, NaN sentinel false', () => {
    expect(evalQuery('today(Date.now())')).toBe(true);
    expect(evalQuery("today(prop('missing', 'ts'))")).toBe(false);
  });

  it('the optional window argument reaches the host as a number (or undefined when omitted)', () => {
    // Args are coerced twice (sandbox wrapper, then hostCall dispatcher) — pin
    // that the host sees numbers, and undefined when the arg is omitted.
    const calls: unknown[][] = [];
    const host = makeHost();
    host.past = (ts, days) => { calls.push(['past', ts, days]); return true; };
    host.future = (ts, days) => { calls.push(['future', ts, days]); return true; };
    host.today = (ts) => { calls.push(['today', ts]); return true; };
    compileAdvancedQuery("past(5, 7) && past(1) && future(9, '30') && today('123')")(host);
    expect(calls).toEqual([
      ['past', 5, 7],
      ['past', 1, undefined],
      ['future', 9, 30],
      ['today', 123],
    ]);
  });
});

describe('compile and evaluation semantics', () => {
  it('throws on a syntactically invalid expression', () => {
    expect(() => compileAdvancedQuery('$$$invalid(((syntax')).toThrow();
  });

  it('compiles a query that ends with a line comment', () => {
    // Regression: the compiled source is `(<query>\n);` — the closing paren must
    // be on its own line, or a trailing `// comment` in the query swallows it
    // and a valid expression becomes a SyntaxError.
    expect(evalQuery("$('apple') // match apple", makeHost('apple pie'))).toBe(true);
    expect(evalQuery('42 // the answer')).toBe(true);
  });

  it('returns truthiness of non-boolean results', () => {
    expect(evalQuery('42')).toBe(true);
    expect(evalQuery('"hello"')).toBe(true);
    expect(evalQuery('0')).toBe(false);
  });

  it('propagates runtime errors in the query to the caller', () => {
    expect(() => evalQuery('nonexistentFn()')).toThrow();
  });

  it('reuses one compiled query across files with different hosts', () => {
    const run = compileAdvancedQuery("$('apple')");
    expect(run(makeHost('apple pie'))).toBe(true);
    expect(run(makeHost('banana'))).toBe(false);
    expect(run(makeHost('apple again'))).toBe(true);
  });
});
