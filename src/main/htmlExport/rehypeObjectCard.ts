import type { Element, ElementContent, Root } from 'hast';
import type { PropertyType } from '../../shared/shared';
import type { GenericObjectData, ObjectRow, ResolvedObject } from '../../shared/objects/genericObject';
import { buildEmailUrl, buildMapUrl, buildPhoneUrl, buildWebUrl } from '../../shared/objects/objectUrls';
import { h } from './hastUtil';

/**
 * Rehype plugin for the folder HTML export: renders the page's object (its front matter, when
 * the front matter's `type` is defined in the Types Editor) as a static card at the top of the
 * page. The object is resolved by the caller with `resolveFrontMatterObject`, the same function
 * the app's MarkdownEntry uses, and the card mirrors the app's ObjectBlock + GenericObject
 * layout: the type caption, a bold title line, then bulleted name / value rows. An object whose
 * values don't fit its type gets the same "Invalid <type>: …" hint the app shows instead.
 *
 * Use it on the page's first column only — the front matter belongs to the page, not a column.
 *
 * See: (USER_GUIDE.md#export-to-folder-html)
 */
export function rehypeObjectCard(object: ResolvedObject | null) {
  return (tree: Root) => {
    if (!object) return;
    const el = object.kind === 'object'
      ? objectCard(object.type, object.data)
      : h('div', { className: ['invalid-object-hint'] }, [`Invalid ${object.type}: ${object.error}`]);
    tree.children.unshift(el, { type: 'text', value: '\n' });
  };
}

/**
 * Marks each row of a card. A plain character rather than per-type icons (the app's card uses
 * heroicons), so the exported HTML stays easy to read as source.
 */
const BULLET = '•';

/** The URL a value of this property type links to, or undefined for plain text (as GenericObject's hrefFor). */
function hrefFor(propertyType: PropertyType, value: string): string | undefined {
  switch (propertyType) {
    case 'email': return buildEmailUrl(value);
    case 'address': return buildMapUrl(value);
    case 'url': return buildWebUrl(value);
    case 'phone': return buildPhoneUrl(value);
    default: return undefined;
  }
}

/** Lays out a card's elements one per line, so the exported source reads cleanly. */
function onePerLine(items: ElementContent[]): ElementContent[] {
  return items.flatMap((item): ElementContent[] => [{ type: 'text', value: '\n' }, item]).concat({ type: 'text', value: '\n' });
}

/** A row of the card: the bullet, the property name, and the value — one source line. */
function row(label: Element, value: Element): Element {
  return h('div', { className: ['object-row'] }, [h('span', { className: ['object-bullet'] }, [BULLET]), label, value]);
}

/** One defined property: name and value (a link for email/address/url/phone; web links open in a new tab). */
function propertyRow(prop: ObjectRow): Element {
  const href = hrefFor(prop.propertyType, prop.value);
  const tooltip = prop.description || prop.key;
  return row(
    h('span', { className: ['object-label'], title: tooltip }, [prop.key]),
    href
      ? h('a', { className: ['object-value'], href, title: tooltip }, [prop.value])
      : h('span', { className: ['object-value'], title: tooltip }, [prop.value]),
  );
}

/** The card for one object: the type caption, the title line, then the rows (when there are any). */
function objectCard(type: string, { title, rows }: GenericObjectData): Element {
  const titleText = title?.value
    ? h('div', { className: ['object-title'], title: title.description || title.key }, [title.value])
    : h('div', { className: ['object-title', 'object-untitled'] }, [`Untitled ${type}`]);

  const children: Element[] = [h('div', { className: ['object-type'] }, [type]), titleText];
  if (rows.length > 0) {
    children.push(h('div', { className: ['object-rows'] }, onePerLine(rows.map(propertyRow))));
  }
  return h('div', { className: ['object-block'], dataObjectType: type }, onePerLine(children));
}
