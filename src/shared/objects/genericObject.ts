import { parseObjectBlock, readTextFields, findTopLevelKeys } from './objectBlock';
import type { ObjectParseResult, KeyRange } from './objectBlock';
import type { PropertyType, TypeDefinition, TypeDefinitions } from '../shared';

/**
 * Typed object blocks resolved against the user-defined types (the `types:` config, edited in
 * the Types Editor): a fenced `yaml` block whose `type` names a defined type renders as a
 * generic card (`GenericObject`) laid out from that type's properties, in definition order.
 * Property types (`email`, `address`, `url`) live only in the definition — never in the block —
 * and are looked up here to decide how each value is presented.
 *
 * Pure (no React), so it runs under plain Node in tests.
 */

/** One defined property of an object, with the value the block gives it. */
export interface ObjectRow {
  key: string;
  /** The value as text: trimmed, numbers stringified, line breaks of a `|` scalar kept. */
  value: string;
  propertyType: PropertyType;
  /** The property's description from the type definition ('' when it has none). */
  description: string;
}

/** A key the block has but its type doesn't define (most often a typo), and its value. */
export interface UnknownRow {
  key: string;
  value: string;
}

/** A validated object, ready for `GenericObject` to lay out. */
export interface GenericObjectData {
  /**
   * The type's first property, shown as the card's bold title line. Its value is '' when the
   * block leaves it blank. Null only for a type with no properties.
   */
  title: ObjectRow | null;
  /** The remaining defined properties that have a value, in definition order. */
  rows: ObjectRow[];
  /** Keys not in the type definition (other than `type`), in block order. */
  unknown: UnknownRow[];
}

export type ResolvedObjectBlock =
  /** A valid object of a defined type. */
  | { kind: 'object'; type: string; data: GenericObjectData }
  /** A defined type whose values don't fit — render the code block plus a hint. */
  | { kind: 'invalid'; type: string; error: string };

/** The definition of `type`, or undefined. hasOwn: `type: toString` must not find a prototype member. */
function definitionOf(defs: TypeDefinitions, type: string): TypeDefinition | undefined {
  return Object.hasOwn(defs, type) ? defs[type] : undefined;
}

/** An unknown key's value as display text. Anything goes here — it isn't validated. */
function displayValue(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' || typeof raw === 'bigint' || typeof raw === 'boolean') return String(raw);
  return JSON.stringify(raw);
}

/**
 * Checks a parsed mapping against a type definition. Every defined property is optional
 * text (see `readTextFields`); a value that isn't text fails with "<key> must be text". A
 * block with none of its type's properties filled in is rejected rather than rendered as an
 * empty card — a freshly inserted block stays code (with a hint) until something is typed.
 */
export function parseGenericObject(def: TypeDefinition, data: Record<string, unknown>): ObjectParseResult<GenericObjectData> {
  const keys = Object.keys(def.properties);
  const read = readTextFields(data, keys);
  if (!read.ok) return read;
  const values = read.value;
  if (keys.length > 0 && Object.keys(values).length === 0) {
    return { ok: false, error: `needs at least one of ${keys.join(', ')}` };
  }

  const toRow = (key: string): ObjectRow => {
    const prop = def.properties[key]!;
    return { key, value: values[key] ?? '', propertyType: prop.type, description: prop.description };
  };
  const [titleKey, ...rest] = keys;
  const unknown = Object.keys(data)
    .filter((key) => key !== 'type' && !Object.hasOwn(def.properties, key))
    .map((key) => ({ key, value: displayValue(data[key]) }));

  return {
    ok: true,
    value: {
      title: titleKey === undefined ? null : toRow(titleKey),
      rows: rest.filter((key) => values[key] !== undefined).map(toRow),
      unknown,
    },
  };
}

/**
 * Decides how a fenced code block should render. Returns null for everything that should stay
 * an ordinary code block: a non-YAML language, YAML that isn't a typed mapping, or a `type`
 * that isn't defined.
 */
export function resolveObjectBlock(language: string, code: string, defs: TypeDefinitions): ResolvedObjectBlock | null {
  const block = parseObjectBlock(language, code);
  if (!block) return null;
  const def = definitionOf(defs, block.type);
  if (!def) return null;

  const result = parseGenericObject(def, block.data);
  return result.ok
    ? { kind: 'object', type: block.type, data: result.value }
    : { kind: 'invalid', type: block.type, error: result.error };
}

/** A property of an object block that its type does not have. */
export interface UnknownObjectKey extends KeyRange {
  /** The block's (defined) type, e.g. "person". */
  type: string;
}

/**
 * Finds the properties of an object block that its type doesn't define — most often a typo
 * (`nmae`). Returns nothing for a block whose type isn't defined, including one whose YAML
 * doesn't currently parse.
 *
 * Which keys the block has comes from the real YAML parse; `findTopLevelKeys` only supplies
 * their positions. `type` itself is never reported.
 */
export function unknownObjectKeys(language: string, code: string, defs: TypeDefinitions): UnknownObjectKey[] {
  const block = parseObjectBlock(language, code);
  if (!block) return [];
  const def = definitionOf(defs, block.type);
  if (!def) return [];

  return findTopLevelKeys(code)
    .filter(({ key }) => key !== 'type' && Object.hasOwn(block.data, key) && !Object.hasOwn(def.properties, key))
    .map((range) => ({ ...range, type: block.type }));
}
