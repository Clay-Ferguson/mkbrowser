import { buildObjectTemplate } from './objectBlock';
import type { ObjectTemplate } from './objectBlock';
import type { TypeDefinitions } from '../shared';

/**
 * The user-defined object types (the `types:` config, edited in the Types Editor) as the
 * editor's "Insert Object" menu uses them. Pure, so it runs under plain Node in tests.
 */

/** One entry of the editor's "Insert Object" menu. */
export interface ObjectTypeOption {
  /** The type name — the `type:` value of the inserted block. */
  type: string;
  /** What the menu shows: the type's description, or its name when it has none. */
  label: string;
}

/** Every defined type, sorted by the label the menu shows. */
export function objectTypeOptions(defs: TypeDefinitions): ObjectTypeOption[] {
  return Object.entries(defs)
    .map(([type, def]) => ({ type, label: def.description || type }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * An empty block of the given type to insert into a document: `type: <name>` plus every
 * property, in definition order, with a blank value. Only the data keys go in — property
 * descriptions and property types stay in the definition. Null if no such type is defined.
 */
export function userObjectTemplate(defs: TypeDefinitions, type: string): ObjectTemplate | null {
  // hasOwn: the name comes from a menu built off this same map, but `toString` must still
  // never resolve to Object.prototype.toString.
  if (!Object.hasOwn(defs, type)) return null;
  const def = defs[type]!;
  return buildObjectTemplate(type, Object.keys(def.properties));
}
