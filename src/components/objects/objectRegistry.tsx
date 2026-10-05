import type { ComponentType, ReactElement } from 'react';
import { parseObjectBlock, findTopLevelKeys } from '../../shared/objects/objectBlock';
import type { ObjectParseResult, KeyRange } from '../../shared/objects/objectBlock';
import { PERSON_TYPE, PERSON_FIELDS, parsePerson } from '../../shared/objects/person';
import PersonObject from './PersonObject';

/**
 * What an object type supplies: the properties it has, a check of the parsed YAML mapping
 * against its shape, and the (module-level) component that renders the validated data.
 *
 * The editor's "Insert Object" menu no longer reads this registry — it inserts the
 * user-defined types from the Types Editor (see `shared/objects/userTypes.ts`).
 */
interface ObjectTypeDef<T> {
  /** Every property the type has. */
  fields: readonly string[];
  parse: (data: Record<string, unknown>) => ObjectParseResult<T>;
  Component: ComponentType<{ data: T }>;
}

/** A registered type with its data type erased: mapping in, rendered element (or error) out. */
interface ObjectType {
  fields: readonly string[];
  resolve: (data: Record<string, unknown>) => ObjectParseResult<ReactElement>;
}

/**
 * Pairs a type's `parse` with its `Component` while `T` is still known, so the registry can
 * hold types with different data shapes without a cast anywhere.
 */
function defineObjectType<T>({ fields, parse, Component }: ObjectTypeDef<T>): ObjectType {
  return {
    fields,
    resolve: (data) => {
      const result = parse(data);
      return result.ok ? { ok: true, value: <Component data={result.value} /> } : result;
    },
  };
}

/**
 * The object types the markdown renderer knows, keyed by the YAML `type` value. To add one:
 * put its shape and `parse` in `src/shared/objects/`, its component beside this file, and
 * register the pair here.
 *
 * A Map rather than an object literal: the key comes from the user's file, and `type: toString`
 * must not find `Object.prototype.toString`.
 */
const OBJECT_TYPES = new Map<string, ObjectType>([
  [PERSON_TYPE, defineObjectType({ fields: PERSON_FIELDS, parse: parsePerson, Component: PersonObject })],
]);

export type ResolvedObjectBlock =
  /** A valid object: `element` is its type's component, to be placed inside an `ObjectBlock`. */
  | { kind: 'object'; type: string; element: ReactElement }
  /** A registered type whose fields don't fit — render the code block plus a hint. */
  | { kind: 'invalid'; type: string; error: string };

/**
 * Decides how a fenced code block should render. Returns null for everything that should stay
 * an ordinary code block: a non-YAML language, YAML that isn't a typed mapping, or a `type`
 * nothing is registered for.
 */
export function resolveObjectBlock(language: string, code: string): ResolvedObjectBlock | null {
  const block = parseObjectBlock(language, code);
  if (!block) return null;
  const objectType = OBJECT_TYPES.get(block.type);
  if (!objectType) return null;

  const result = objectType.resolve(block.data);
  return result.ok
    ? { kind: 'object', type: block.type, element: result.value }
    : { kind: 'invalid', type: block.type, error: result.error };
}

/** A property of an object block that its type does not have. */
export interface UnknownObjectKey extends KeyRange {
  /** The block's (registered) type, e.g. "person". */
  type: string;
}

/**
 * Finds the properties of an object block that its type doesn't define — most often a typo
 * (`nmae`), which the card would otherwise silently drop. Returns nothing for a block
 * that isn't a registered object type, including one whose YAML doesn't currently parse.
 *
 * Which keys the block has comes from the real YAML parse; `findTopLevelKeys` only supplies
 * their positions. `type` itself is never reported.
 */
export function unknownObjectKeys(language: string, code: string): UnknownObjectKey[] {
  const block = parseObjectBlock(language, code);
  if (!block) return [];
  const objectType = OBJECT_TYPES.get(block.type);
  if (!objectType) return [];

  return findTopLevelKeys(code)
    .filter(({ key }) => key !== 'type' && Object.hasOwn(block.data, key) && !objectType.fields.includes(key))
    .map((range) => ({ ...range, type: block.type }));
}
