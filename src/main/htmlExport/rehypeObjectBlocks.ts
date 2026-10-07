import type { Element, ElementContent, Root } from 'hast';
import type { PropertyType, TypeDefinitions } from '../../shared/shared';
import { resolveObjectBlock } from '../../shared/objects/genericObject';
import type { GenericObjectData, ObjectRow } from '../../shared/objects/genericObject';
import { buildEmailUrl, buildMapUrl, buildWebUrl } from '../../shared/objects/objectUrls';
import { classesOf, h, textOf, walkElements } from './hastUtil';

/**
 * Rehype plugin for the folder HTML export: renders typed object blocks (a fenced
 * `yaml` block whose `type` is defined in the Types Editor) as static cards. The
 * block is classified by `resolveObjectBlock`, the same function the app's CustomPre
 * uses, and the card mirrors the app's ObjectBlock + GenericObject layout: the type
 * caption, a bold title line, then icon / name / value rows, with keys the type
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

// Heroicons (24/outline) path data for the card's icons — the same icons the app's
// GenericObject uses; @heroicons/react is a renderer-only devDependency.
const ICON_PATHS = {
  cube: ['m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9'],
  envelope: ['M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75'],
  mapPin: [
    'M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    'M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z',
  ],
  link: ['M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244'],
  phone: ['M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z'],
  calendar: ['M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5'],
} as const;

type IconName = keyof typeof ICON_PATHS;

/** Row icon per property type, as in GenericObject's TYPE_ICONS; plain text rows have none. */
const TYPE_ICONS: Partial<Record<PropertyType, IconName>> = {
  email: 'envelope',
  address: 'mapPin',
  url: 'link',
  phone: 'phone',
  date: 'calendar',
};

function icon(name: IconName, className: string): Element {
  return h(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.5',
      className: ['object-icon', className],
      ariaHidden: 'true',
    },
    ICON_PATHS[name].map((d) => h('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d })),
  );
}

/** The URL a value of this property type links to, or undefined for plain text (as GenericObject's hrefFor). */
function hrefFor(propertyType: PropertyType, value: string): string | undefined {
  switch (propertyType) {
    case 'email': return buildEmailUrl(value);
    case 'address': return buildMapUrl(value);
    case 'url': return buildWebUrl(value);
    default: return undefined;
  }
}

/** One defined property: icon cell, name, value (a new-tab link for email/address/url). */
function propertyRow(row: ObjectRow): ElementContent[] {
  const iconName = TYPE_ICONS[row.propertyType];
  const href = hrefFor(row.propertyType, row.value);
  const tooltip = row.description || row.key;
  return [
    h('span', { className: ['object-row-icon'] }, iconName ? [icon(iconName, 'object-icon-row')] : []),
    h('span', { className: ['object-label'], title: tooltip }, [row.key]),
    href
      ? h('a', { className: ['object-value'], href, target: '_blank', rel: ['noopener'], title: tooltip }, [row.value])
      : h('span', { className: ['object-value'], title: tooltip }, [row.value]),
  ];
}

function objectCard(type: string, { title, rows, unknown }: GenericObjectData): Element {
  const titleText = title?.value
    ? h('span', { className: ['object-title-text'], title: title.description || title.key }, [title.value])
    : h('span', { className: ['object-title-text', 'object-untitled'] }, [`Untitled ${type}`]);

  const children: ElementContent[] = [
    h('div', { className: ['object-type'] }, [type]),
    h('div', { className: ['object-title'] }, [icon('cube', 'object-icon-title'), titleText]),
  ];
  if (rows.length > 0 || unknown.length > 0) {
    children.push(h('div', { className: ['object-rows'] }, [
      ...rows.flatMap(propertyRow),
      ...unknown.flatMap(({ key, value }) => [
        h('span'),
        h('span', { className: ['object-label', 'object-unknown'], title: `"${key}" is not a ${type} property` }, [key]),
        h('span', { className: ['object-value'] }, [value]),
      ]),
    ]));
  }
  return h('div', { className: ['object-block'], dataObjectType: type }, children);
}
