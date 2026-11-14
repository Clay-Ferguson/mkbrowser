/**
 * Sandboxed compilation/evaluation of advanced-search query expressions, and of
 * custom sort expressions (which share the same sandbox and helpers).
 *
 * The user's advanced query is arbitrary JavaScript, but it must never be able
 * to touch the file system (or anything else in the main process). Instead of
 * `new Function(...)` — which runs the query with full Node.js privileges — the
 * query is compiled once per search into a bare `node:vm` context.
 *
 * The sandbox works because NO host object is ever reachable from the query:
 * every known vm escape starts from a host reference (host `Function` via
 * `someHostObject.constructor.constructor`, etc.). The search helpers ($, tag,
 * p, ts, past, future, today) are defined *inside* the sandbox realm as thin wrappers
 * that call a single host dispatcher, and only primitives cross the boundary in
 * either direction (objects read through `p` are JSON round-tripped; host errors are
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
 *
 * See: (USER_GUIDE.md#advanced-search-predicates)
 */
import vm from 'node:vm';
import type { SortKey, SortKeyScalar } from '../shared/shared';

/** Wall-clock budget for evaluating the query against ONE file. Generous — a
 * legitimate query over a 20 MB file finishes in well under this — but it turns
 * an infinite loop into a per-search error instead of a frozen main process.
 * The watchdog adds ~80µs per evaluation (measured), immaterial next to the
 * per-file stat+read the search already does.
 *
 * See: (USER_GUIDE.md#advanced-search-predicates)
 */
const EVAL_TIMEOUT_MS = 1000;

/** Host-side helpers the sandboxed query calls back into, rebound per file. */
export interface AdvancedQueryHost {
  $: (searchText: string) => boolean;
  tag: (hashtag: string) => boolean;
  /** Top-level front-matter property `name` (backs the `p` object). */
  getProp: (name: string) => unknown;
  past: (timestamp: number, lookbackDays?: number) => boolean;
  future: (timestamp: number, lookaheadDays?: number) => boolean;
  today: (timestamp: number) => boolean;
  ts: (dateStr: string) => number;
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

/** Thrown by compileAdvancedQuery when the query is not a valid expression. */
export class AdvancedQuerySyntaxError extends Error {
  constructor(detail: string, what = 'advanced search query') {
    super(`Invalid ${what}: ${detail}`);
    this.name = 'AdvancedQuerySyntaxError';
  }
}

/** Thrown when the query throws while being evaluated against one file. The
 * message is a plain string built inside the sandbox (see compileAdvancedQuery),
 * so no sandbox object ever reaches host code. */
export class AdvancedQueryRuntimeError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'AdvancedQueryRuntimeError';
  }
}

/** Defines $, tag, p, ts, past, future, today inside the sandbox realm as wrappers
 * around the host dispatcher, then removes the dispatcher from the global so
 * query code can only reach it through these frozen wrappers. Runs once per
 * compiled query.
 *
 * See: (USER_GUIDE.md#advanced-search-predicates)
 */
const BOOTSTRAP = `
(() => {
  'use strict';
  const call = __hostCall;
  delete globalThis.__hostCall;
  const def = (name, fn) => Object.defineProperty(globalThis, name, {
    value: fn, writable: false, configurable: false, enumerable: true,
  });
  def('$', (text) => call('$', String(text)));
  def('tag', (hashtag) => call('tag', String(hashtag)));
  def('past', (ts, days) => call('past', Number(ts), days === undefined ? undefined : Number(days)));
  def('future', (ts, days) => call('future', Number(ts), days === undefined ? undefined : Number(days)));
  def('today', (ts) => call('today', Number(ts)));
  // ts: date string -> ms timestamp (local time). A missing value
  // (undefined/null) is NaN, the "no date" sentinel.
  def('ts', (v) => (v === undefined || v === null ? NaN : call('ts', String(v))));
  // p: front-matter property object — p.type reads the file's 'type' property.
  // A sandbox-realm Proxy (no host object involved). Strings and objects arrive
  // JSON-encoded (so no host object ever enters this realm) and are revived
  // here; other primitives arrive as-is. Symbol keys (e.g. Symbol.toPrimitive)
  // yield undefined.
  def('p', new Proxy(Object.create(null), {
    get: (_t, key) => {
      if (typeof key !== 'string') return undefined;
      const v = call('getProp', key);
      return typeof v === 'string' ? JSON.parse(v) : v;
    },
  }));
})();
`;

/** What a compiled expression produces: a match/no-match boolean (an advanced
 * query) or a sort key (a custom sort expression). */
type ScriptMode = 'predicate' | 'sortKey';

/** Inside the sandbox, turns a caught value into a primitive error description.
 * Shared by both script templates below. */
const CATCH_TO_STRING = `e !== null && typeof e === 'object'
        ? String(e.name) + ': ' + String(e.message)
        : String(e)`;

/**
 * Sandbox-side normalization of a custom sort expression's value into a SortKey:
 * finite numbers and strings pass through, booleans become 1/0, a Date becomes
 * its timestamp, and anything else (undefined, null, NaN, objects) becomes null,
 * "no value". An array is normalized element by element — one level only, so a
 * nested array or object element is null.
 *
 * See: (USER_GUIDE.md#custom-sort-order)
 */
const SORT_KEY_NORMALIZE = `((v) => {
      const one = (x) => {
        if (typeof x === 'number') return Number.isFinite(x) ? x : null;
        if (typeof x === 'string') return x;
        if (typeof x === 'boolean') return x ? 1 : 0;
        if (x instanceof Date) { const t = x.getTime(); return Number.isFinite(t) ? t : null; }
        return null;
      };
      return Array.isArray(v) ? Array.prototype.map.call(v, one) : one(v);
    })`;

/**
 * Wraps the query in the sandboxed evaluation script and compiles it (without
 * running it). Returns the compiled script, or V8's syntax-error message.
 *
 * The wrapping matters: the parens make object literals (`{a: 1}`) parse as an
 * expression rather than a block, and the closing `)` MUST sit on its own line.
 * If it shared the query's line, a query ending in a line comment — e.g.
 * `$('apple') // match apple` — would swallow the `)` into the comment and turn
 * a valid expression into "Unexpected end of input". The newline is safe: it
 * sits inside the parens, so ASI cannot terminate the expression there.
 *
 * The try/catch runs INSIDE the sandbox so a thrown value is turned into a
 * string there, under the timeout watchdog. Reading `.message` (or calling
 * String()) on a sandbox object from host code would run query-defined
 * getters/toString with no timeout — `throw { get message() { for(;;); } }`
 * would hang the main process. A 'predicate' script therefore only ever returns
 * a boolean (the result) or a string (the error description): both primitives.
 *
 * A 'sortKey' script can't use that split, since a string is a legitimate sort
 * key. It normalizes the value inside the sandbox (see SORT_KEY_NORMALIZE) and
 * always returns a JSON string: `["ok", key]` or `["err", message]`. The host
 * only ever JSON.parses that string, so no sandbox object crosses over.
 */
function compileQueryScript(queryStr: string, mode: ScriptMode = 'predicate'): vm.Script | string {
  const source = mode === 'predicate'
    ? `(() => {
  try {
    return !!(${queryStr}
    );
  } catch (e) {
    try {
      return ${CATCH_TO_STRING};
    } catch {
      return 'Unknown error';
    }
  }
})();`
    : `(() => {
  try {
    const __sortKeyValue = (${queryStr}
    );
    return JSON.stringify(['ok', ${SORT_KEY_NORMALIZE}(__sortKeyValue)]);
  } catch (e) {
    try {
      return JSON.stringify(['err', ${CATCH_TO_STRING}]);
    } catch {
      return '["err","Unknown error"]';
    }
  }
})();`;
  try {
    return new vm.Script(source, { filename: mode === 'predicate' ? 'advanced-search-query' : 'custom-sort-expression' });
  } catch (err) {
    // A compile error comes from V8's parser, not from query code, so it's a
    // host SyntaxError and safe to read.
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Returns V8's syntax-error message for an advanced query, or null if it parses.
 * Only compiles the query — nothing runs. Backs the Search dialog's validation,
 * which can't parse the query itself: the renderer's CSP forbids `unsafe-eval`.
 *
 * See: (USER_GUIDE.md#advanced-search-predicates)
 */
export function getAdvancedQuerySyntaxError(queryStr: string): string | null {
  const result = compileQueryScript(queryStr);
  return typeof result === 'string' ? result : null;
}

/**
 * Builds the sandbox realm for a compiled script and returns a function that runs
 * it against one file's helpers. The raw result is returned as-is (a primitive,
 * per compileQueryScript); a timeout surfaces as AdvancedQueryTimeoutError.
 */
function createSandboxRunner(script: vm.Script): (host: AdvancedQueryHost) => unknown {
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
        case 'tag':
          return h.tag(String(a0));
        case 'past':
          return h.past(Number(a0), a1 === undefined ? undefined : Number(a1));
        case 'future':
          return h.future(Number(a0), a1 === undefined ? undefined : Number(a1));
        case 'today':
          return h.today(Number(a0));
        case 'ts':
          return h.ts(String(a0));
        case 'getProp': {
          const v = h.getProp(String(a0));
          if (v === null || v === undefined) return v;
          const t = typeof v;
          // Numbers pass through raw (JSON would corrupt NaN/Infinity — e.g. a
          // YAML `.nan` — into null). Strings/objects/arrays
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

  return (h: AdvancedQueryHost): unknown => {
    host = h;
    try {
      return script.runInContext(context, { timeout: EVAL_TIMEOUT_MS });
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

/**
 * Compile an advanced query expression into a sandboxed evaluator.
 *
 * Throws AdvancedQuerySyntaxError on a syntactically invalid expression. The
 * returned function evaluates the expression against one file's helpers and
 * returns its truthiness; a runtime error in the query surfaces as
 * AdvancedQueryRuntimeError, and a timeout as AdvancedQueryTimeoutError.
 *
 * See: (USER_GUIDE.md#advanced-search-predicates)
 */
export function compileAdvancedQuery(queryStr: string): (host: AdvancedQueryHost) => boolean {
  // Compile FIRST so a syntax error throws before we bother building a context.
  const result = compileQueryScript(queryStr);
  if (typeof result === 'string') throw new AdvancedQuerySyntaxError(result);
  const run = createSandboxRunner(result);

  return (h: AdvancedQueryHost): boolean => {
    const value = run(h);
    if (typeof value === 'string') throw new AdvancedQueryRuntimeError(value);
    return value === true;
  };
}

/** One file's evaluated custom sort expression. */
export interface SortKeyResult {
  key: SortKey;
  /** Every finite timestamp `ts()` returned during the evaluation, so callers
   * can tell which numbers in `key` are dates (for display). */
  dates: Set<number>;
}

/**
 * Compile a custom sort expression into a sandboxed evaluator that returns each
 * file's sort key. Runs in the same sandbox, with the same helpers, as an
 * advanced query. Throws AdvancedQuerySyntaxError on an invalid expression; a
 * runtime error surfaces as AdvancedQueryRuntimeError, and a timeout as
 * AdvancedQueryTimeoutError.
 *
 * See: (USER_GUIDE.md#custom-sort-order)
 */
export function compileSortKeyExpression(exprStr: string): (host: AdvancedQueryHost) => SortKeyResult {
  const result = compileQueryScript(exprStr, 'sortKey');
  if (typeof result === 'string') throw new AdvancedQuerySyntaxError(result, 'custom sort expression');
  const run = createSandboxRunner(result);

  return (h: AdvancedQueryHost): SortKeyResult => {
    const dates = new Set<number>();
    const ts = (dateStr: string): number => {
      const t = h.ts(dateStr);
      if (Number.isFinite(t)) dates.add(t);
      return t;
    };
    const value = run({ ...h, ts });
    // Always a string from the sandbox (see compileQueryScript), so parsing it
    // creates only host-realm values.
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : null;
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      throw new AdvancedQueryRuntimeError('Custom sort expression produced an unreadable value');
    }
    if (parsed[0] === 'err') throw new AdvancedQueryRuntimeError(String(parsed[1]));
    return { key: toSortKey(parsed[1]), dates };
  };
}

/** Coerces a JSON-parsed value to a SortKey (JSON already turned NaN into null). */
function toSortKey(value: unknown): SortKey {
  const scalar = (v: unknown): SortKeyScalar =>
    typeof v === 'number' || typeof v === 'string' ? v : null;
  return Array.isArray(value) ? value.map(scalar) : scalar(value);
}
