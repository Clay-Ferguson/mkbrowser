import { loadYaml } from '../yamlUtil';

/**
 * Typed object blocks: a fenced `yaml` code block whose content is a mapping with a string
 * `type` property describes an object (e.g. a person) that the markdown renderer can present
 * as a card instead of as source code.
 *
 * This module is the low-level pure half — detecting such a block and reading its fields — and
 * has no React in it, so it runs (and is unit-tested) under plain Node. Resolving a block
 * against the user-defined types is `genericObject.ts`; the card components live in
 * `src/components/objects/`.
 */

/** A fenced block that parsed as an object: its `type` and the whole mapping (`type` included). */
export interface ParsedObjectBlock {
  type: string;
  data: Record<string, unknown>;
}

/** Outcome of checking a parsed mapping against one object type's shape. */
export type ObjectParseResult<T> =
  | { ok: true; value: T }
  /** `error` completes the sentence "Invalid <type>: …", e.g. "address must be text". */
  | { ok: false; error: string };

const YAML_LANGUAGES = new Set(['yaml', 'yml']);

function isPlainMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a fenced code block as a typed object, or returns null when it isn't one — in which
 * case the caller renders it as the ordinary code block it is. A block qualifies only when its
 * language is `yaml`/`yml`, the YAML parses, the document is a single mapping, and that mapping
 * has a non-empty string `type`. Malformed YAML is deliberately not an error here: a code block
 * that doesn't parse is still a perfectly good code block.
 */
export function parseObjectBlock(language: string, code: string): ParsedObjectBlock | null {
  if (!YAML_LANGUAGES.has(language.toLowerCase())) return null;

  let parsed: unknown;
  try {
    parsed = loadYaml(code);
  } catch {
    return null;
  }

  if (!isPlainMapping(parsed)) return null;
  const type = parsed.type;
  if (typeof type !== 'string' || type.trim() === '') return null;
  return { type: type.trim(), data: parsed };
}

/**
 * Reads the given keys off a parsed mapping as optional text fields.
 *
 * - A missing key, a null value, or a blank string is simply absent from the result.
 * - A number is converted to its string form, so an unquoted `cell_phone: 5551234567` works.
 * - Strings are trimmed (a `|` block scalar always ends in a newline).
 * - Anything else — a list, a nested mapping, a boolean — fails with "<key> must be text".
 *
 * Keys not listed are ignored, so a block may carry extra properties.
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

/** A new, empty object block ready to insert into a markdown document. */
export interface ObjectTemplate {
  /** The whole fenced block, opening and closing fence included, with no trailing newline. */
  text: string;
  /** Offset into `text` where the first field's value goes — where the cursor should land. */
  cursorOffset: number;
}

/**
 * Builds an empty fenced block for an object type: `type: <type>` followed by every field with
 * a blank value. Each `key: ` keeps its trailing space so typing right after it yields valid
 * YAML (`name:Clay`, with no space, is not a key/value pair).
 *
 * A freshly inserted block has no values yet, so it is not a valid object until at least one
 * is filled in — until then it renders as code with the type's "Invalid …" hint.
 */
export function buildObjectTemplate(type: string, fields: readonly string[]): ObjectTemplate {
  const head = `\`\`\`yaml\ntype: ${type}\n`;
  const body = fields.map((field) => `${field}: \n`).join('');
  const [first] = fields;
  return {
    text: `${head}${body}\`\`\``,
    // End of the first field's line, or — for a type with no fields — of the `type:` line.
    cursorOffset: first === undefined ? head.length - 1 : head.length + first.length + 2,
  };
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
 * keys exist by parsing the YAML properly and use this to find them (see
 * `unknownObjectKeys`), so a line this misreads can at worst go unreported.
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
