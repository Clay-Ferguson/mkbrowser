/**
 * Renders markdown through react-markdown with the real CustomPre, to pin the object-block
 * dispatch end to end: fenced text → <pre><code class="language-yaml"> → card, hint, or code.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import CustomPre from '../src/components/CustomPre';
import { preprocessMathEscapes, stripHtmlComments, preprocessWikiLinks } from '../src/shared/mkUtil';

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
      'first_name: Clay',
      'last_name: Ferguson',
      'cell_phone: 5551234567',
      'email: clay@example.com',
      'address: |',
      '  1 Main St',
      '  Dallas, TX',
    ].join('\n')));

    expect(html).toContain('data-testid="object-block"');
    expect(html).toContain('data-object-type="person"');
    expect(html).toContain('Clay Ferguson');
    expect(html).toContain('5551234567');
    expect(html).toContain('clay@example.com');
    expect(html).toContain('1 Main St\nDallas, TX');
    // No source code and no copy button.
    expect(html).not.toContain('<code');
    expect(html).not.toContain('first_name');
    expect(html).not.toContain('Copy code');
    // The surrounding markdown is unaffected.
    expect(html).toContain('<p>before</p>');
    expect(html).toContain('<p>after</p>');
  });

  it('escapes markup in field values', () => {
    const html = render(fence('yaml', 'type: person\nfirst_name: "<img src=x onerror=alert(1)>"'));
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
    ['an unregistered type', 'yaml', 'type: gadget\nname: x'],
    ['yaml without a type', 'yaml', 'first_name: Clay'],
    ['malformed yaml', 'yaml', 'type: person\n first_name: [x'],
    ['a json block', 'json', '{"type": "person", "first_name": "Clay"}'],
    ['an untagged block', '', 'type: person\nfirst_name: Clay'],
  ])('leaves %s as an ordinary code block', (_label, language, body) => {
    const html = render(fence(language, body));
    expect(html).not.toContain('data-testid="object-block"');
    expect(html).not.toContain('data-testid="invalid-object-hint"');
    expect(html).toContain('<code');
    expect(html).toContain('Copy code');
  });
});
