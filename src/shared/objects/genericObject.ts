import { readTextFields } from './objectBlock';
import type { ObjectParseResult } from './objectBlock';
import type { PropertyType, TypeDefinition, TypeDefinitions } from '../shared';

/**
 * A file's object resolved against the user-defined types (the `types:` config, edited in the
 * Types Editor). A markdown file holds at most one object, and it lives in the file's front
 * matter: a `type:` naming a defined type, plus that type's properties as sibling keys. It
 * renders as a generic card (`GenericObject`) laid out from the type's properties, in
 * definition order. Property types (`email`, `address`, `url`) live only in the definition —
 * never in the front matter — and are looked up here to decide how each value is presented.
 *
 * Pure (no React), so it runs under plain Node in tests.
 */

/** One defined property of an object, with the value the front matter gives it. */
export interface ObjectRow {
  key: string;
  /** The value as text: trimmed, numbers stringified, line breaks of a `|` scalar kept. */
  value: string;
  propertyType: PropertyType;
  /** The property's description from the type definition ('' when it has none). */
  description: string;
}

/** A validated object, ready for `GenericObject` to lay out. */
export interface GenericObjectData {
  /**
   * The type's first property, shown as the card's bold title line. Its value is '' when the
   * object leaves it blank. Null only for a type with no properties.
   */
  title: ObjectRow | null;
  /** The remaining defined properties that have a value, in definition order. */
  rows: ObjectRow[];
}

export type ResolvedObject =
  /** A valid object of a defined type. */
  | { kind: 'object'; type: string; data: GenericObjectData }
  /** A defined type whose values don't fit — render a hint instead of the card. */
  | { kind: 'invalid'; type: string; error: string };

/** Whether two type names are the same type. Type names are case-insensitive: `Person` is `person`. */
export function sameTypeName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The defined type name that `name` refers to, ignoring case, or undefined. An exact match wins,
 * so a hand-edited config that defines both `Person` and `person` (which the Types Editor
 * refuses to save) still resolves each one to itself. Only own keys are considered: `type:
 * toString` must not find a prototype member.
 */
export function findTypeName(defs: TypeDefinitions, name: string): string | undefined {
  if (Object.hasOwn(defs, name)) return name;
  return Object.keys(defs).find((key) => sameTypeName(key, name));
}

/**
 * The front matter's object type (as the definition spells it) and its definition, or null when
 * the front matter has no `type`, its `type` isn't a non-empty string, or it names no defined
 * type (matched ignoring case — `Person` is `person`).
 */
function objectTypeOf(props: Record<string, unknown>, defs: TypeDefinitions): { type: string; def: TypeDefinition } | null {
  // hasOwn, not `props.type`: never read an inherited property off parsed, untrusted data.
  const raw = Object.hasOwn(props, 'type') ? props['type'] : undefined;
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  const type = name === '' ? undefined : findTypeName(defs, name);
  return type === undefined ? null : { type, def: defs[type]! };
}

/**
 * Whether the front matter's `type` names a defined type — only `type` is checked, not whether
 * the other properties fit it. Starting an edit of such a file switches the editor to Show
 * Properties (see `editingPatch` in store/items.ts).
 */
export function hasObjectType(props: Record<string, unknown>, defs: TypeDefinitions): boolean {
  return objectTypeOf(props, defs) !== null;
}

/**
 * Checks front matter against a type definition. Every defined property is optional text (see
 * `readTextFields`); a value that isn't text fails with "<key> must be text". Keys the type
 * doesn't define are ignored — front matter legitimately holds others (`tags`, `id`, `due`, …).
 * An object with nothing filled in yet is still valid: its card is titled "Untitled <type>".
 */
export function parseGenericObject(def: TypeDefinition, data: Record<string, unknown>): ObjectParseResult<GenericObjectData> {
  const keys = Object.keys(def.properties);
  const read = readTextFields(data, keys);
  if (!read.ok) return read;
  const values = read.value;

  const toRow = (key: string): ObjectRow => {
    const prop = def.properties[key]!;
    return { key, value: values[key] ?? '', propertyType: prop.type, description: prop.description };
  };
  const [titleKey, ...rest] = keys;

  return {
    ok: true,
    value: {
      title: titleKey === undefined ? null : toRow(titleKey),
      rows: rest.filter((key) => values[key] !== undefined).map(toRow),
    },
  };
}

/**
 * Decides whether a file's front matter (parsed to a mapping) is an object, and if so how it
 * renders. Returns null when there is no object: no `type`, or a `type` that isn't defined.
 */
export function resolveFrontMatterObject(props: Record<string, unknown>, defs: TypeDefinitions): ResolvedObject | null {
  const found = objectTypeOf(props, defs);
  if (!found) return null;

  const result = parseGenericObject(found.def, props);
  return result.ok
    ? { kind: 'object', type: found.type, data: result.value }
    : { kind: 'invalid', type: found.type, error: result.error };
}

/**
 * The front-matter keys that belong to the file's object — `type` plus every property its type
 * defines — or an empty set when the front matter has no object. The property pills leave these
 * out, since the object's card already shows them.
 */
export function objectPropertyKeys(props: Record<string, unknown>, defs: TypeDefinitions): Set<string> {
  const found = objectTypeOf(props, defs);
  return found ? new Set(['type', ...Object.keys(found.def.properties)]) : new Set();
}
