/**
 * Renders markdown through react-markdown with the real CustomPre, to pin the object-block
 * dispatch end to end: fenced text → <pre><code class="language-yaml"> → card, hint, or code.
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import CustomPre from '../src/components/CustomPre';
import { preprocessMathEscapes, stripHtmlComments, preprocessWikiLinks } from '../src/shared/mkUtil';
import type { TypeDefinitions } from '../src/shared/shared';
import { PERSON_DEFS } from './fixtures/personTypeDefs';

// CustomPre resolves object blocks against the user-defined types it selects from the store.
// Server rendering reads a Zustand store's *initial* state (its server snapshot), so setting
// the types on the real store would be invisible here; the selector is fed them directly.
const { TYPE_DEFS } = vi.hoisted(() => ({ TYPE_DEFS: {} as TypeDefinitions }));
vi.mock('../src/store', () => ({
  useAS: <T,>(selector: (s: { typeDefs: TypeDefinitions }) => T): T => selector({ typeDefs: TYPE_DEFS }),
}));
Object.assign(TYPE_DEFS, PERSON_DEFS, {
  gizmo: { properties: { model: { description: '', type: 'text' }, site: { description: 'Vendor site', type: 'url' } } },
});

function render(markdown: string): string {
  // The same preprocessing MarkdownView applies before parsing.
  const text = preprocessWikiLinks(preprocessMathEscapes(stripHtmlComments(markdown)));
  return renderToStaticMarkup(createElement(Markdown, { components: { pre: CustomPre } }, text));
}

const fence = (language: string, body: string) => `before\n\n\`\`\`${language}\n${body}\n\`\`\`\n\nafter`;

describe('CustomPre object blocks', () => {
  it('renders a person block as a card instead of code', () => {
    const html = render(fence('yaml', [
      'type: person',
      'name: Clay Ferguson',
      'bd: 1980-05-12',
      'cell_phone: 5551234567',
      'email: clay@example.com',
      'address: |',
      '  1 Main St',
      '  Dallas, TX',
      'notes: |',
      '  Met at a conference.',
      '  Prefers email.',
    ].join('\n')));

    expect(html).toContain('data-testid="object-block"');
    expect(html).toContain('data-object-type="person"');
    expect(html).toContain('Clay Ferguson');
    expect(html).toContain('1980-05-12');
    expect(html).toContain('5551234567');
    expect(html).toContain('clay@example.com');
    expect(html).toContain('1 Main St\nDallas, TX');
    expect(html).toContain('Met at a conference.\nPrefers email.');
    // No source code and no copy button.
    expect(html).not.toContain('<code');
    expect(html).not.toContain('name:');
    expect(html).not.toContain('Copy code');
    // The surrounding markdown is unaffected.
    expect(html).toContain('<p>before</p>');
    expect(html).toContain('<p>after</p>');
  });

  it('labels each row with its property name, in definition order, title first', () => {
    const html = render(fence('yaml', 'type: person\nnotes: hi\nemail: a@b.c\nname: Clay'));
    expect(html).toContain('Clay');
    const order = ['>email<', '>notes<'].map((label) => html.indexOf(label));
    expect(order.every((i) => i > html.indexOf('Clay'))).toBe(true);
    expect(order[0]).toBeLessThan(order[1]!);
    // The title property is not repeated as a row.
    expect(html).not.toContain('>name<');
  });

  it('makes email, address, and url values clickable, and leaves text plain', () => {
    const person = render(fence('yaml', 'type: person\nname: Clay\nbd: May 12\nemail: a@b.c\naddress: 1 Main St'));
    expect(person.match(/open in browser/g)).toHaveLength(2);
    expect(person).toContain('title="Email: open in browser"');
    expect(person).toContain('title="Address: open in browser"');
    const gizmo = render(fence('yaml', 'type: gizmo\nmodel: X1\nsite: example.com'));
    expect(gizmo).toContain('data-object-type="gizmo"');
    expect(gizmo).toContain('title="Vendor site: open in browser"');
  });

  it('lists unknown keys last, flagged, with their values', () => {
    const html = render(fence('yaml', 'type: person\nname: Clay\nnmae: Typo\nemail: a@b.c'));
    expect(html).toContain('data-testid="object-block"');
    expect(html).toContain('data-testid="object-unknown-property"');
    expect(html).toContain('title="&quot;nmae&quot; is not a person property"');
    expect(html).toContain('text-orange-400');
    expect(html).toContain('Typo');
    expect(html.indexOf('nmae')).toBeGreaterThan(html.indexOf('a@b.c'));
  });

  it('escapes markup in field values', () => {
    const html = render(fence('yaml', 'type: person\nname: "<img src=x onerror=alert(1)>"'));
    expect(html).toContain('data-testid="object-block"');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('keeps a person with bad fields as code and adds a hint', () => {
    const html = render(fence('yaml', 'type: person\naddress:\n  street: 1 Main St'));
    expect(html).not.toContain('data-testid="object-block"');
    expect(html).toContain('<code class="language-yaml">');
    expect(html).toContain('Copy code');
    expect(html).toContain('data-testid="invalid-object-hint"');
    expect(html).toContain('Invalid person: address must be text');
  });

  it.each([
    ['an undefined type', 'yaml', 'type: gadget\nname: x'],
    ['yaml without a type', 'yaml', 'name: Clay'],
    ['malformed yaml', 'yaml', 'type: person\n name: [x'],
    ['a json block', 'json', '{"type": "person", "name": "Clay"}'],
    ['an untagged block', '', 'type: person\nname: Clay'],
  ])('leaves %s as an ordinary code block', (_label, language, body) => {
    const html = render(fence(language, body));
    expect(html).not.toContain('data-testid="object-block"');
    expect(html).not.toContain('data-testid="invalid-object-hint"');
    expect(html).toContain('<code');
    expect(html).toContain('Copy code');
  });
});
