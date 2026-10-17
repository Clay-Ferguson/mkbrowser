import { findTopLevelKeys } from './objectBlock';
import { objectPropertyKeys } from './genericObject';
import { assembleFrontMatter, splitFrontMatter } from '../frontMatterUtil';
import { loadYaml } from '../yamlUtil';
import { formatDate } from '../timeUtil';
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
 * Plans "Insert Object": makes the document's front matter an object of `type` (a file holds at
 * most one object, and it lives there), creating the front matter if there is none.
 *
 * The object is `type: <name>` plus every property of the type, in definition order. Every key
 * the front matter already has is kept as it is, whatever its value — so inserting a type over
 * front matter that already has some of its properties (e.g. a `name:`) keeps those values. Only
 * missing keys are added, each with a blank value — except a `date`-typed property, which gets
 * `today` (`MM/DD/YY`). A blank `type:` is given the type name.
 *
 * Inserting the type the file's object already is just fills in that object's missing properties
 * (e.g. ones added to the type since). Front matter whose `type` names any other value is refused:
 * a second object can never be added over a first one.
 *
 * Where the added lines go: for a new object, at the top of the block, so `type:` comes first;
 * when the front matter already has a `type:` line, at the end, after the existing object.
 *
 * Only the front-matter region is replaced; the body is never touched. The new front matter
 * is re-parsed before it is offered, so a block this can't safely add lines to (flow style,
 * `{a: 1}`) is refused rather than corrupted. The cursor lands at the end of the type's first
 * property line that has no value yet (or of its first property, when all are filled in), ready
 * for its value.
 */
export function planObjectInsertion(content: string, defs: TypeDefinitions, type: string, today = formatDate()): ObjectInsertion {
  // hasOwn: the name comes from a menu built off this same map, but `toString` must still
  // never resolve to Object.prototype.toString.
  if (!Object.hasOwn(defs, type)) return { ok: false, error: `"${type}" is not a defined type.` };
  const properties = defs[type]!.properties;
  const propertyKeys = Object.keys(properties);
  const keys = ['type', ...propertyKeys];
  // A new date property starts out as today; every other new property starts out blank.
  const isDate = (key: string) => properties[key]?.type === 'date';
  const lineFor = (key: string) => (key === 'type' ? `type: ${type}` : isDate(key) ? `${key}: ${today}` : `${key}: `);

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

  const hasType = Object.hasOwn(existing, 'type');
  if (hasType && !isBlank(existing['type'])) {
    const current = existing['type'];
    if (typeof current !== 'string' || current.trim() !== type) {
      return { ok: false, error: `This file already holds an object (type: ${String(current)}). A file can hold only one object; inserting that same type adds any properties it is missing.` };
    }
  } else if (hasType) {
    // A blank `type:` that is already there is given the type name, in place.
    const at = findTopLevelKeys(yaml).find(({ key }) => key === 'type');
    if (!at) return { ok: false, error: 'The front matter\'s empty "type" property couldn\'t be located. Remove it before inserting an object.' };
    const lineEnd = yaml.indexOf('\n', at.from);
    yaml = yaml.slice(0, at.from) + lineFor('type') + (lineEnd < 0 ? '' : yaml.slice(lineEnd));
  }

  const missing = keys.filter((key) => !Object.hasOwn(existing, key)).map(lineFor);
  const existingLines = yaml ? [yaml] : [];
  const newYaml = (hasType ? [...existingLines, ...missing] : [...missing, ...existingLines]).join('\n');

  // Never trust a textual YAML edit without re-parsing it (see injectCalendarFrontMatter).
  try {
    const check = loadYaml(newYaml) as Record<string, unknown> | undefined;
    const checkType = check?.['type'];
    if (typeof checkType !== 'string' || checkType.trim() !== type) throw new Error('type not set');
  } catch {
    return { ok: false, error: 'The front matter is in a form an object can\'t be added to. Rewrite it as one "key: value" per line first.' };
  }

  const insert = `${OPEN_FENCE}${newYaml}\n---\n`;
  // End of the first property's line that still needs a value — or of the first property's line
  // when all have one, or of the `type:` line, for a type with no properties.
  // A date property added just now already holds today, so it doesn't count as needing a value.
  const needsValue = (key: string) => (Object.hasOwn(existing, key) ? isBlank(existing[key]) : !isDate(key));
  const cursorKey = propertyKeys.find(needsValue) ?? propertyKeys[0] ?? 'type';
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

/**
 * Puts the front matter of a file that holds an object into its canonical order: `id` first
 * (when present), then `type` and the type's properties in definition order, then every other
 * key alphabetically. Run on every Markdown save (the `write-file` handler), so the order the
 * Types Editor gives a type's properties is the order they appear in the file.
 *
 * Front matter without an object is returned untouched, as is front matter already in order —
 * a save never churns a block it doesn't need to change.
 *
 * Keys are moved as whole lines of text (a key's line plus everything up to the next top-level
 * key: nested values, block scalars, trailing comments), never re-serialized, so every value
 * keeps exactly the form the user wrote. Any lines before the first key stay at the top. The
 * YAML is parsed only to find the object; a block whose parsed keys don't match the keys
 * located in its text (flow style, unusual keys) is left alone rather than risked.
 */
export function orderObjectFrontMatter(content: string, defs: TypeDefinitions): string {
  const split = splitFrontMatter(content);
  if (!split) return content;
  let parsed: unknown;
  try {
    parsed = loadYaml(split.yamlStr);
  } catch {
    return content;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return content;
  const objectKeys = objectPropertyKeys(parsed as Record<string, unknown>, defs);
  if (objectKeys.size === 0) return content;

  const yaml = `${split.yamlStr}\n`;
  const located = findTopLevelKeys(yaml);
  const keys = located.map(({ key }) => key);
  const parsedKeys = Object.keys(parsed);
  if (keys.length !== parsedKeys.length || !parsedKeys.every((key) => keys.includes(key))) return content;

  const rank = (key: string) => (key === 'id' ? 0 : objectKeys.has(key) ? 1 : 2);
  const objectOrder = [...objectKeys];
  const ordered = [...keys].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 1 ? objectOrder.indexOf(a) - objectOrder.indexOf(b) : a.localeCompare(b)));
  if (ordered.every((key, i) => key === keys[i])) return content;

  const chunkOf = new Map(located.map(({ key, from }, i) => [key, yaml.slice(from, located[i + 1]?.from ?? yaml.length)]));
  const preamble = yaml.slice(0, located[0]!.from);
  return assembleFrontMatter(preamble + ordered.map((key) => chunkOf.get(key)).join(''), split.body);
}
