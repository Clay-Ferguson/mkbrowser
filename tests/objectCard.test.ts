/**
 * The object card: a file's front matter, resolved against the user-defined types, rendered
 * through the real ObjectBlock + GenericObject the way MarkdownEntry shows it. Also pins that a
 * typed YAML fence in the body is no longer special — CustomPre renders it as ordinary code.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { jsx } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import CustomPre from '../src/components/CustomPre';
import ObjectBlock from '../src/components/objects/ObjectBlock';
import GenericObject from '../src/components/objects/GenericObject';
import { parseFrontMatter } from '../src/shared/frontMatterUtil';
import { resolveFrontMatterObject } from '../src/shared/objects/genericObject';
import type { TypeDefinitions } from '../src/shared/shared';
import { PERSON_DEFS } from './fixtures/personTypeDefs';

const TYPE_DEFS: TypeDefinitions = {
  ...PERSON_DEFS,
  gizmo: {
    properties: {
      model: { description: '', type: 'text' },
      site: { description: 'Vendor site', type: 'url' },
      support: { description: 'Support line', type: 'phone' },
    },
  },
};

/** The card for a file whose front matter is `yaml`, or '' when it holds no valid object. */
function renderCard(yaml: string): string {
  const content = `---\n${yaml}\n---\nBody text.`;
  const props = parseFrontMatter(content).yaml ?? {};
  const object = resolveFrontMatterObject(props, TYPE_DEFS);
  if (object?.kind !== 'object') return '';
  // `jsx()` (what JSX compiles to) takes children as a prop, which is how ObjectBlock types them.
  return renderToStaticMarkup(jsx(ObjectBlock, {
    type: object.type,
    source: content,
    onMouseUp: () => {},
    children: jsx(GenericObject, { type: object.type, data: object.data }),
  }));
}

describe('object card', () => {
  it('renders a person as a card', () => {
    const html = renderCard([
      'id: abc123',
      'type: person',
      'name: Clay Ferguson',
      'bd: 1980-05-12',
      'cell_phone: 5551234567',
      'email: clay@example.com',
      'tags:',
      '  - friend',
      'address: |',
      '  1 Main St',
      '  Dallas, TX',
      'notes: |',
      '  Met at a conference.',
      '  Prefers email.',
    ].join('\n'));

    expect(html).toContain('data-testid="object-block"');
    expect(html).toContain('data-object-type="person"');
    expect(html).toContain('Clay Ferguson');
    expect(html).toContain('1980-05-12');
    expect(html).toContain('5551234567');
    expect(html).toContain('clay@example.com');
    expect(html).toContain('1 Main St\nDallas, TX');
    expect(html).toContain('Met at a conference.\nPrefers email.');
    // Other front-matter keys are not part of the object.
    expect(html).not.toContain('abc123');
    expect(html).not.toContain('friend');
  });

  it('labels each row with its property name, in definition order, title first', () => {
    const html = renderCard('type: person\nnotes: hi\nemail: a@b.c\nname: Clay');
    expect(html).toContain('Clay');
    const order = ['>email<', '>notes<'].map((label) => html.indexOf(label));
    expect(order.every((i) => i > html.indexOf('Clay'))).toBe(true);
    expect(order[0]).toBeLessThan(order[1]!);
    // The title property is not repeated as a row.
    expect(html).not.toContain('>name<');
  });

  it('shows an object with nothing filled in yet as an untitled card', () => {
    const html = renderCard('type: person\nname:\nemail:');
    expect(html).toContain('data-testid="object-block"');
    expect(html).toContain('Untitled person');
  });

  it('makes email, address, url, and phone values clickable, and leaves text plain', () => {
    const person = renderCard('type: person\nname: Clay\nbd: May 12\nemail: a@b.c\naddress: 1 Main St');
    expect(person.match(/open in browser/g)).toHaveLength(1);
    expect(person).toContain('title="Email: send email"');
    expect(person).toContain('title="Address: open in browser"');
    const gizmo = renderCard('type: gizmo\nmodel: X1\nsite: example.com\nsupport: +1 (555) 123-4567');
    expect(gizmo).toContain('data-object-type="gizmo"');
    expect(gizmo).toContain('title="Vendor site: open in browser"');
    expect(gizmo).toContain('title="Support line: call"');
  });

  it('escapes markup in field values', () => {
    const html = renderCard('type: person\nname: "<img src=x onerror=alert(1)>"');
    expect(html).toContain('data-testid="object-block"');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('typed YAML fences in the body', () => {
  it('render as ordinary code, not as a card', () => {
    const markdown = 'before\n\n```yaml\ntype: person\nname: Clay\n```\n\nafter';
    const html = renderToStaticMarkup(createElement(Markdown, { components: { pre: CustomPre } }, markdown));
    expect(html).not.toContain('data-testid="object-block"');
    expect(html).toContain('<code class="language-yaml">');
    expect(html).toContain('Copy code');
  });
});
