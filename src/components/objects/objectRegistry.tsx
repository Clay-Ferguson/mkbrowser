import type { ComponentType, ReactElement } from 'react';
import { parseObjectBlock } from '../../shared/objects/objectBlock';
import type { ObjectParseResult } from '../../shared/objects/objectBlock';
import { PERSON_TYPE, parsePerson } from '../../shared/objects/person';
import PersonObject from './PersonObject';

/**
 * What an object type supplies: a check of the parsed YAML mapping against its shape, and the
 * (module-level) component that renders the validated data.
 */
interface ObjectTypeDef<T> {
  parse: (data: Record<string, unknown>) => ObjectParseResult<T>;
  Component: ComponentType<{ data: T }>;
}

/** A registered type with its data type erased: mapping in, rendered element (or error) out. */
type ObjectType = (data: Record<string, unknown>) => ObjectParseResult<ReactElement>;

/**
 * Pairs a type's `parse` with its `Component` while `T` is still known, so the registry can
 * hold types with different data shapes without a cast anywhere.
 */
function defineObjectType<T>({ parse, Component }: ObjectTypeDef<T>): ObjectType {
  return (data) => {
    const result = parse(data);
    return result.ok ? { ok: true, value: <Component data={result.value} /> } : result;
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
  [PERSON_TYPE, defineObjectType({ parse: parsePerson, Component: PersonObject })],
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

  const result = objectType(block.data);
  return result.ok
    ? { kind: 'object', type: block.type, element: result.value }
    : { kind: 'invalid', type: block.type, error: result.error };
}
