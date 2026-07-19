/**
 * Sandboxed compilation/evaluation of advanced-search query expressions.
 *
 * The user's advanced query is arbitrary JavaScript, but it must never be able
 * to touch the file system (or anything else in the main process). Instead of
 * `new Function(...)` — which runs the query with full Node.js privileges — the
 * query is compiled once per search into a bare `node:vm` context.
 *
 * The sandbox works because NO host object is ever reachable from the query:
 * every known vm escape starts from a host reference (host `Function` via
 * `someHostObject.constructor.constructor`, etc.). The search helpers ($, prop,
 * past, future, today) are defined *inside* the sandbox realm as thin wrappers
 * that call a single host dispatcher, and only primitives cross the boundary in
 * either direction (objects from `prop` are JSON round-tripped; host errors are
 * re-thrown as primitive strings). The sandbox's own intrinsics (its `Function`,
 * `eval`, …) are harmless — code they create still runs inside the empty realm,
 * where `process`/`require` simply don't exist.
 *
 * `node:vm` is not a certified security boundary (a V8 bug could in principle be
 * exploited), but for this threat model — the machine's owner typing a query, or
 * a query accidentally populated from somewhere it shouldn't be — it removes the
 * entire fs/process attack surface. The per-evaluation timeout (with
 * `microtaskMode: 'afterEvaluate'` so promise tricks can't dodge the watchdog)
 * also stops `while(true){}` from hanging the main process.
 */
import vm from 'node:vm';

/** Wall-clock budget for evaluating the query against ONE file. Generous — a
 * legitimate query over a 20 MB file finishes in well under this — but it turns
 * an infinite loop into a per-search error instead of a frozen main process.
 * The watchdog adds ~80µs per evaluation (measured), immaterial next to the
 * per-file stat+read the search already does. */
const EVAL_TIMEOUT_MS = 1000;

/** Host-side helpers the sandboxed query calls back into, rebound per file. */
export interface AdvancedQueryHost {
  $: (searchText: string) => boolean;
  prop: (propPath: string, valType?: 'string' | 'ts') => unknown;
  past: (timestamp: number, lookbackDays?: number) => boolean;
  future: (timestamp: number, lookaheadDays?: number) => boolean;
  today: (timestamp: number) => boolean;
}

/** Thrown when the query exceeds EVAL_TIMEOUT_MS on a file. The same query will
 * almost certainly time out on every file, so callers should abort the whole
 * search rather than eat the timeout thousands of times. */
export class AdvancedQueryTimeoutError extends Error {
  constructor() {
    super(`Advanced search query timed out after ${EVAL_TIMEOUT_MS}ms — check the query for an infinite loop.`);
    this.name = 'AdvancedQueryTimeoutError';
  }
}

/** Defines $, prop, past, future, today inside the sandbox realm as wrappers
 * around the host dispatcher, then removes the dispatcher from the global so
 * query code can only reach it through these frozen wrappers. Runs once per
 * compiled query. */
const BOOTSTRAP = `
(() => {
  'use strict';
  const call = __hostCall;
  delete globalThis.__hostCall;
  const def = (name, fn) => Object.defineProperty(globalThis, name, {
    value: fn, writable: false, configurable: false, enumerable: true,
  });
  def('$', (text) => call('$', String(text)));
  def('past', (ts, days) => call('past', Number(ts), days === undefined ? undefined : Number(days)));
  def('future', (ts, days) => call('future', Number(ts), days === undefined ? undefined : Number(days)));
  def('today', (ts) => call('today', Number(ts)));
  // prop: strings and objects arrive JSON-encoded (so no host object ever
  // enters this realm) and are revived here; other primitives arrive as-is.
  def('prop', (path, valType) => {
    const v = call('prop', String(path), valType === undefined ? undefined : String(valType));
    return typeof v === 'string' ? JSON.parse(v) : v;
  });
})();
`;

/**
 * Compile an advanced query expression into a sandboxed evaluator.
 *
 * Throws on a syntactically invalid expression (mirrors `new Function`, so the
 * caller's existing compile-error handling applies). The returned function
 * evaluates the expression against one file's helpers and returns its truthiness;
 * runtime errors in the query propagate to the caller, and a timeout surfaces as
 * AdvancedQueryTimeoutError.
 */
export function compileAdvancedQuery(queryStr: string): (host: AdvancedQueryHost) => boolean {
  // Compile FIRST so a syntax error throws before we bother building a context.
  //
  // The wrapping matters: the parens make object literals (`{a: 1}`) parse as an
  // expression rather than a block, and the closing `)` MUST sit on its own line.
  // If it shared the query's line, a query ending in a line comment — e.g.
  // `$('apple') // match apple` — would swallow the `)` into the comment and turn
  // a valid expression into "Unexpected end of input". The newline is safe: it
  // sits inside the parens, so ASI cannot terminate the expression there.
  const script = new vm.Script(`(${queryStr}\n);`, { filename: 'advanced-search-query' });

  // Rebound before each evaluation; the dispatcher below closes over it.
  let host: AdvancedQueryHost | null = null;

  // The single host function exposed to the sandbox. Its prototype is severed so
  // the sandbox can't walk fn.constructor to the host Function constructor, and
  // it must only ever return / throw primitives (see module doc).
  const hostCall = (name: unknown, a0: unknown, a1: unknown): unknown => {
    try {
      const h = host!;
      switch (name) {
        case '$':
          return h.$(String(a0));
        case 'past':
          return h.past(Number(a0), a1 === undefined ? undefined : Number(a1));
        case 'future':
          return h.future(Number(a0), a1 === undefined ? undefined : Number(a1));
        case 'today':
          return h.today(Number(a0));
        case 'prop': {
          const v = h.prop(String(a0), a1 === 'ts' ? 'ts' : undefined);
          if (v === null || v === undefined) return v;
          const t = typeof v;
          // Numbers pass through raw (JSON would corrupt NaN — the NO_TIMESTAMP
          // sentinel from prop(..., 'ts') — into null). Strings/objects/arrays
          // are JSON-encoded so the sandbox revives them in its own realm.
          if (t === 'number' || t === 'boolean' || t === 'bigint') return v;
          return JSON.stringify(v);
        }
        default:
          return undefined;
      }
    } catch (err) {
      // Never let a host Error object cross into the sandbox (its prototype
      // chain reaches the host Function constructor). Throw a primitive.
      throw String(err instanceof Error ? err.message : err);
    }
  };
  Object.setPrototypeOf(hostCall, null);

  // Bare context: a null-prototype global with only the sandbox realm's own
  // intrinsics. afterEvaluate runs the query's microtasks inside the timeout
  // watchdog, closing the Promise-based timeout dodge.
  const context = vm.createContext(Object.create(null), { microtaskMode: 'afterEvaluate' });
  (context as Record<string, unknown>).__hostCall = hostCall;
  vm.runInContext(BOOTSTRAP, context);

  return (h: AdvancedQueryHost): boolean => {
    host = h;
    try {
      return Boolean(script.runInContext(context, { timeout: EVAL_TIMEOUT_MS }));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
        throw new AdvancedQueryTimeoutError();
      }
      throw err;
    } finally {
      host = null;
    }
  };
}
