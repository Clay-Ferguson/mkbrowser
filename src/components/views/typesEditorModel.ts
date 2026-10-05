import { DEFAULT_PROPERTY_TYPE } from '../../shared/shared';
import type { PropertyDefinition, PropertyType, TypeDefinition, TypeDefinitions } from '../../shared/shared';

/**
 * Pure model for the Types Editor (TypesEditorView): converts the persisted
 * `types:` config map to an id-keyed, ordered editor model and back, and
 * validates it before save. Kept free of React so it can be unit tested.
 */

/**
 * Allowed type and property names: a letter or underscore followed by letters,
 * digits, or underscores (e.g. `cell_phone`). This matches the keys object
 * blocks already use, and since it rules out integer-like keys, JS object key
 * order (and so YAML key order) is always insertion order.
 */
export const TYPE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Property name reserved because object blocks use `type:` as their discriminator. */
export const RESERVED_PROPERTY_NAME = 'type';

export interface EditorProperty {
  id: string;
  name: string;
  description: string;
  type: PropertyType;
  /** Keys of the persisted definition the editor doesn't know about, carried through a save. */
  extra: Record<string, unknown>;
}

export interface EditorType {
  id: string;
  name: string;
  description: string;
  properties: EditorProperty[];
  /** Keys of the persisted definition the editor doesn't know about, carried through a save. */
  extra: Record<string, unknown>;
}

// Stable per-row keys for the editor's local model; only need to be unique within a session.
function newId() { return crypto.randomUUID(); }

function singleLine(s: string): string {
  return s.replace(/\n/g, ' ').trim();
}

/** A new, empty property row. */
export function newEditorProperty(): EditorProperty {
  return { id: newId(), name: '', description: '', type: DEFAULT_PROPERTY_TYPE, extra: {} };
}

/** A new, empty type row. */
export function newEditorType(): EditorType {
  return { id: newId(), name: '', description: '', properties: [], extra: {} };
}

/**
 * Convert the persisted types map into the editor model: assign row ids, keep
 * key order, flatten multi-line descriptions, and stash unknown keys in `extra`.
 * Inverse of toTypeDefs.
 */
export function fromTypeDefs(defs: TypeDefinitions): EditorType[] {
  return Object.entries(defs).map(([typeName, def]) => {
    const { description, properties, ...typeExtra } = def;
    return {
      id: newId(),
      name: typeName,
      description: singleLine(description ?? ''),
      properties: Object.entries(properties).map(([propName, prop]) => {
        const { description: propDescription, type: propType, ...propExtra } = prop;
        return {
          id: newId(),
          name: propName,
          description: singleLine(propDescription),
          type: propType,
          extra: propExtra,
        };
      }),
      extra: typeExtra,
    };
  });
}

/**
 * Convert the editor model back to the persisted shape: trim names, drop the
 * row ids, merge `extra` back in, and omit an empty type description.
 * Inverse of fromTypeDefs.
 */
export function toTypeDefs(editor: EditorType[]): TypeDefinitions {
  const defs: TypeDefinitions = {};
  for (const type of editor) {
    const properties: Record<string, PropertyDefinition> = {};
    for (const prop of type.properties) {
      properties[prop.name.trim()] = { ...prop.extra, description: prop.description.trim(), type: prop.type };
    }
    const description = type.description.trim();
    // Description goes before properties so it reads first in config.yaml.
    const def: TypeDefinition = description
      ? { ...type.extra, description, properties }
      : { ...type.extra, properties };
    defs[type.name.trim()] = def;
  }
  return defs;
}

/**
 * Drop property rows whose name and description are both blank (e.g. one the
 * user added but never filled in), so they're silently discarded on Save
 * instead of failing validation.
 */
export function dropBlankProperties(editor: EditorType[]): EditorType[] {
  return editor.map((type) => ({
    ...type,
    properties: type.properties.filter((p) => p.name.trim() !== '' || p.description.trim() !== ''),
  }));
}

/**
 * Returns the first validation problem as a user-facing message, or null when
 * the types are valid: type and property names must be non-empty, match
 * TYPE_NAME_PATTERN, and be unique (types globally, properties within their
 * type), and no property may use the reserved name `type`. Expects fully blank
 * properties to have been removed already (see dropBlankProperties).
 */
export function validate(editor: EditorType[]): string | null {
  const typeNames = editor.map((t) => t.name.trim());
  if (typeNames.some((n) => n === '')) return 'Type names cannot be empty.';
  const badType = typeNames.find((n) => !TYPE_NAME_PATTERN.test(n));
  if (badType !== undefined) return `Invalid type name "${badType}": use letters, digits, and underscores, not starting with a digit.`;
  if (new Set(typeNames).size !== typeNames.length) return 'Type names must be unique.';
  for (const type of editor) {
    const typeName = type.name.trim();
    const propNames = type.properties.map((p) => p.name.trim());
    if (propNames.some((n) => n === '')) return `Properties in "${typeName}" that have a description need a name.`;
    const badProp = propNames.find((n) => !TYPE_NAME_PATTERN.test(n));
    if (badProp !== undefined) return `Invalid property name "${badProp}" in "${typeName}": use letters, digits, and underscores, not starting with a digit.`;
    if (propNames.includes(RESERVED_PROPERTY_NAME)) return `"${RESERVED_PROPERTY_NAME}" is reserved and can't be used as a property name (in "${typeName}").`;
    if (new Set(propNames).size !== propNames.length) return `Duplicate property names in type "${typeName}".`;
  }
  return null;
}
