import type { Element, ElementContent, Root } from 'hast';
import type { PropertyType, TypeDefinitions } from '../../shared/shared';
import { resolveObjectBlock } from '../../shared/objects/genericObject';
import type { GenericObjectData, ObjectRow } from '../../shared/objects/genericObject';
import { buildEmailUrl, buildMapUrl, buildPhoneUrl, buildWebUrl } from '../../shared/objects/objectUrls';
import { classesOf, h, textOf, walkElements } from './hastUtil';

/**
 * Rehype plugin for the folder HTML export: renders typed object blocks (a fenced
 * `yaml` block whose `type` is defined in the Types Editor) as static cards. The
 * block is classified by `resolveObjectBlock`, the same function the app's CustomPre
 * uses, and the card mirrors the app's ObjectBlock + GenericObject layout: the type
 * caption, a bold title line, then bulleted name / value rows, with keys the type
 * doesn't define listed last. A block whose values don't fit its type stays a code
 * block, followed by the same "Invalid <type>: …" hint the app shows.
 */
export function rehypeObjectBlocks(typeDefs: TypeDefinitions) {
  return (tree: Root) => {
    walkElements(tree, (el, parent, index) => {
      if (el.tagName !== 'pre') return;
      const code = el.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
      if (!code) return;
      const language = classesOf(code).find((c) => c.startsWith('language-'))?.slice('language-'.length);
      if (!language) return;

      const resolved = resolveObjectBlock(language, textOf(code).replace(/\n$/, ''), typeDefs);
      if (resolved?.kind === 'object') {
        parent.children[index] = objectCard(resolved.type, resolved.data);
      } else if (resolved?.kind === 'invalid') {
        // A sibling after the block, not a wrapper around it: the walk descends into
        // whatever sits at `index`, and a wrapper would bring this <pre> round again.
        const hint = h('div', { className: ['invalid-object-hint'] }, [`Invalid ${resolved.type}: ${resolved.error}`]);
        parent.children.splice(index + 1, 0, hint);
      }
    });
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

function objectCard(type: string, { title, rows, unknown }: GenericObjectData): Element {
  const titleText = title?.value
    ? h('div', { className: ['object-title'], title: title.description || title.key }, [title.value])
    : h('div', { className: ['object-title', 'object-untitled'] }, [`Untitled ${type}`]);

  const children: Element[] = [h('div', { className: ['object-type'] }, [type]), titleText];
  if (rows.length > 0 || unknown.length > 0) {
    children.push(h('div', { className: ['object-rows'] }, onePerLine([
      ...rows.map(propertyRow),
      ...unknown.map(({ key, value }) => row(
        h('span', { className: ['object-label', 'object-unknown'], title: `"${key}" is not a ${type} property` }, [key]),
        h('span', { className: ['object-value'] }, [value]),
      )),
    ])));
  }
  return h('div', { className: ['object-block'], dataObjectType: type }, onePerLine(children));
}
