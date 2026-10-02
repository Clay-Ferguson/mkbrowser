import type { ComponentType, ReactElement } from 'react';
import { parseObjectBlock, buildObjectTemplate } from '../../shared/objects/objectBlock';
import type { ObjectParseResult, ObjectTemplate } from '../../shared/objects/objectBlock';
import { PERSON_TYPE, PERSON_LABEL, PERSON_FIELDS, parsePerson } from '../../shared/objects/person';
import PersonObject from './PersonObject';

/**
 * What an object type supplies: its display name, the properties it has, a check of the parsed
 * YAML mapping against its shape, and the (module-level) component that renders the validated
 * data.
 */
interface ObjectTypeDef<T> {
  /** Display name, e.g. "Person" — shown in the editor's "Insert Object" menu. */
  label: string;
  /** Every property the type has, in the order a new block lists them. */
  fields: readonly string[];
  parse: (data: Record<string, unknown>) => ObjectParseResult<T>;
  Component: ComponentType<{ data: T }>;
}

/** A registered type with its data type erased: mapping in, rendered element (or error) out. */
interface ObjectType {
  label: string;
  fields: readonly string[];
  resolve: (data: Record<string, unknown>) => ObjectParseResult<ReactElement>;
}

/**
 * Pairs a type's `parse` with its `Component` while `T` is still known, so the registry can
 * hold types with different data shapes without a cast anywhere.
 */
function defineObjectType<T>({ label, fields, parse, Component }: ObjectTypeDef<T>): ObjectType {
  return {
    label,
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
  [PERSON_TYPE, defineObjectType({ label: PERSON_LABEL, fields: PERSON_FIELDS, parse: parsePerson, Component: PersonObject })],
]);

/** One entry of the editor's "Insert Object" menu. */
export interface ObjectTypeOption {
  type: string;
  label: string;
}

/** Every registered type, in registration order, for menus that let the user pick one. */
export const OBJECT_TYPE_OPTIONS: readonly ObjectTypeOption[] = Array.from(
  OBJECT_TYPES,
  ([type, { label }]) => ({ type, label }),
);

/** An empty block of the given type to insert into a document, or null if it isn't registered. */
export function objectTemplate(type: string): ObjectTemplate | null {
  const objectType = OBJECT_TYPES.get(type);
  return objectType ? buildObjectTemplate(type, objectType.fields) : null;
}

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
