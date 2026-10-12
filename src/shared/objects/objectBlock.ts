/**
 * Low-level, React-free helpers for objects (see `genericObject.ts`): reading an object's
 * fields off its parsed front matter, and locating top-level keys in YAML text. Runs (and is
 * unit-tested) under plain Node.
 */

/** Outcome of checking a parsed mapping against one object type's shape. */
export type ObjectParseResult<T> =
  | { ok: true; value: T }
  /** `error` completes the sentence "Invalid <type>: …", e.g. "address must be text". */
  | { ok: false; error: string };

/**
 * Reads the given keys off a parsed mapping as optional text fields.
 *
 * - A missing key, a null value, or a blank string is simply absent from the result.
 * - A number is converted to its string form, so an unquoted `cell_phone: 5551234567` works.
 * - Strings are trimmed (a `|` block scalar always ends in a newline).
 * - Anything else — a list, a nested mapping, a boolean — fails with "<key> must be text".
 *
 * Keys not listed are ignored, so the front matter may carry other properties.
 */
export function readTextFields<K extends string>(
  data: Record<string, unknown>,
  keys: readonly K[],
): ObjectParseResult<Partial<Record<K, string>>> {
  const value: Partial<Record<K, string>> = {};
  for (const key of keys) {
    // hasOwn, not `data[key]`: never read an inherited property off parsed, untrusted data.
    const raw = Object.hasOwn(data, key) ? data[key] : undefined;
    if (raw === undefined || raw === null) continue;
    if (typeof raw === 'number' || typeof raw === 'bigint') {
      value[key] = String(raw);
    } else if (typeof raw === 'string') {
      const text = raw.trim();
      if (text !== '') value[key] = text;
    } else {
      return { ok: false, error: `${key} must be text` };
    }
  }
  return { ok: true, value };
}

/** A top-level key of a YAML block, with where it sits in the block's text. */
export interface KeyRange {
  key: string;
  /** Offsets into the block's text; a quoted key's range includes its quotes. */
  from: number;
  to: number;
}

// A key at the very start of a line, followed by `:` and then whitespace or the line end —
// either quoted (group 2 is the text inside the quotes) or plain (group 3).
const TOP_LEVEL_KEY = /^(?:(["'])(.*?)\1|([A-Za-z0-9_][^:]*?))[ \t]*:(?=[ \t]|$)/;

/**
 * Locates the top-level keys of a block-style YAML mapping by line: a key is a line that
 * starts in column 0 with `key:`. Indented lines — nested values, list items, the body of a
 * `|` block scalar — are never top-level keys, and are skipped.
 *
 * This is a *locator*, not a parser: it only says where a key's text is. Callers decide which
 * keys exist by parsing the YAML properly and use this only to find them (see
 * `planObjectInsertion`).
 */
export function findTopLevelKeys(code: string): KeyRange[] {
  const keys: KeyRange[] = [];
  let lineStart = 0;
  for (const line of code.split('\n')) {
    const match = TOP_LEVEL_KEY.exec(line);
    if (match) {
      const quoted = match[2];
      const plain = match[3];
      if (quoted !== undefined) {
        keys.push({ key: quoted, from: lineStart, to: lineStart + quoted.length + 2 });
      } else if (plain !== undefined) {
        keys.push({ key: plain, from: lineStart, to: lineStart + plain.length });
      }
    }
    lineStart += line.length + 1;
  }
  return keys;
}
