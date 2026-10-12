import { findTopLevelKeys } from './objectBlock';
import { splitFrontMatter } from '../frontMatterUtil';
import { loadYaml } from '../yamlUtil';
import type { TypeDefinitions } from '../shared';

/**
 * The user-defined object types (the `types:` config, edited in the Types Editor) as the
 * editor's "Insert Object" menu uses them. Pure, so it runs under plain Node in tests.
 */

/** One entry of the editor's "Insert Object" menu. */
export interface ObjectTypeOption {
  /** The type name — the `type:` value written into the front matter. */
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
 * The edit that adds an object to a document, or why it can't be added. On success, replacing
 * `[from, to)` with `insert` applies it, and `cursor` is where the cursor goes afterwards (in
 * the changed document).
 */
export type ObjectInsertion =
  | { ok: true; from: number; to: number; insert: string; cursor: number }
  /** A complete sentence for the user; the document is left as it is. */
  | { ok: false; error: string };

/** A front-matter value that counts as "not filled in": missing, null (`name:`), or a blank string. */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

const OPEN_FENCE = '---\n';

/**
 * Plans "Insert Object": adds an empty object of `type` to the document's front matter (a file
 * holds at most one object, and it lives there), creating the front matter if there is none.
 *
 * The object is `type: <name>` plus every property of the type, in definition order, each with
 * a blank value. Lines for keys the front matter doesn't have yet go at the top of the block.
 * A key the front matter already has *with a value* is a conflict, and nothing is changed — in
 * particular a second object can never be added over a first one. A key that is already there
 * but blank is left where it is, except a blank `type:`, which is given the type name.
 *
 * Only the front-matter region is replaced; the body is never touched. The new front matter
 * is re-parsed before it is offered, so a block this can't safely add lines to (flow style,
 * `{a: 1}`) is refused rather than corrupted. The cursor lands at the end of the type's first
 * property line, ready for its value.
 */
export function planObjectInsertion(content: string, defs: TypeDefinitions, type: string): ObjectInsertion {
  // hasOwn: the name comes from a menu built off this same map, but `toString` must still
  // never resolve to Object.prototype.toString.
  if (!Object.hasOwn(defs, type)) return { ok: false, error: `"${type}" is not a defined type.` };
  const propertyKeys = Object.keys(defs[type]!.properties);
  const keys = ['type', ...propertyKeys];
  const lineFor = (key: string) => (key === 'type' ? `type: ${type}` : `${key}: `);

  const split = splitFrontMatter(content);
  let existing: Record<string, unknown> = {};
  let yaml = '';
  if (split) {
    let parsed: unknown;
    try {
      parsed = loadYaml(split.yamlStr);
    } catch {
      return { ok: false, error: 'The front matter is not valid YAML. Fix it before inserting an object.' };
    }
    if (parsed !== null && parsed !== undefined) {
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'The front matter is not a set of "key: value" properties, so an object can\'t be added to it.' };
      }
      existing = parsed as Record<string, unknown>;
    }
    // A block holding only blank lines or comments contributes nothing worth keeping in place.
    yaml = split.yamlStr.trim() === '' ? '' : split.yamlStr.replace(/\s+$/, '');
  }

  const filled = keys.filter((key) => Object.hasOwn(existing, key) && !isBlank(existing[key]));
  if (filled.includes('type')) {
    return { ok: false, error: `This file already holds an object (type: ${String(existing['type'])}). A file can hold only one object.` };
  }
  if (filled.length > 0) {
    const list = filled.map((key) => `"${key}"`).join(', ');
    return { ok: false, error: `The front matter already has a value for ${list}. Remove or rename ${filled.length > 1 ? 'those properties' : 'that property'} before inserting a ${type}.` };
  }

  // A blank `type:` that is already there is given the type name, in place.
  if (Object.hasOwn(existing, 'type')) {
    const at = findTopLevelKeys(yaml).find(({ key }) => key === 'type');
    if (!at) return { ok: false, error: 'The front matter\'s empty "type" property couldn\'t be located. Remove it before inserting an object.' };
    const lineEnd = yaml.indexOf('\n', at.from);
    yaml = yaml.slice(0, at.from) + lineFor('type') + (lineEnd < 0 ? '' : yaml.slice(lineEnd));
  }

  const missing = keys.filter((key) => !Object.hasOwn(existing, key)).map(lineFor);
  const newYaml = [...missing, ...(yaml ? [yaml] : [])].join('\n');

  // Never trust a textual YAML edit without re-parsing it (see injectCalendarFrontMatter).
  try {
    const check = loadYaml(newYaml) as Record<string, unknown> | undefined;
    if (check?.['type'] !== type) throw new Error('type not set');
  } catch {
    return { ok: false, error: 'The front matter is in a form an object can\'t be added to. Rewrite it as one "key: value" per line first.' };
  }

  const insert = `${OPEN_FENCE}${newYaml}\n---\n`;
  // End of the first property's line — or of the `type:` line, for a type with no properties.
  const cursorKey = propertyKeys[0] ?? 'type';
  const at = findTopLevelKeys(newYaml).find(({ key }) => key === cursorKey);
  const lineEnd = at ? newYaml.indexOf('\n', at.from) : -1;
  const cursorInYaml = !at ? 0 : lineEnd < 0 ? newYaml.length : lineEnd;

  return {
    ok: true,
    from: 0,
    to: split ? content.length - split.body.length : 0,
    insert,
    cursor: OPEN_FENCE.length + cursorInYaml,
  };
}
