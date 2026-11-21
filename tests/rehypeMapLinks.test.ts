import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { rehypeMapLinks } from '../src/shared/rehypeMapLinks';
import { buildMapUrl } from '../src/shared/objects/objectUrls';
import { safeUrlTransform } from '../src/shared/mkUtil';

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeMapLinks)
  .use(rehypeStringify);

function render(md: string): string {
  return String(processor.processSync(md));
}

/** The href as rehype-stringify writes it (`&` escaped in attributes). */
const mapHref = (address: string) => buildMapUrl(address).replace(/&/g, '&#x26;');

describe('rehypeMapLinks', () => {
  it('searches for the link text when map: has no address', () => {
    expect(render('Meet at [123 Main St, Springfield, IL](map:).')).toBe(
      `<p>Meet at <a href="${mapHref('123 Main St, Springfield, IL')}">123 Main St, Springfield, IL</a>.</p>`,
    );
  });

  it('searches for the address after map:, keeping the link text', () => {
    expect(render("[Mom's house](<map:123 Main St, Springfield, IL>)")).toBe(
      `<p><a href="${mapHref('123 Main St, Springfield, IL')}">Mom's house</a></p>`,
    );
  });

  it('decodes a percent-encoded address and accepts any case of the scheme', () => {
    expect(render('[x](MAP:10%20Downing%20St)')).toContain(`href="${mapHref('10 Downing St')}"`);
  });

  it('uses the plain text of formatted link text', () => {
    expect(render('[**1 Elm** St](map:)')).toContain(`href="${mapHref('1 Elm St')}"`);
  });

  it('leaves other links and empty map links alone', () => {
    expect(render('[a](https://example.com) [b](notes.md)')).toBe(
      '<p><a href="https://example.com">a</a> <a href="notes.md">b</a></p>',
    );
    expect(render('[ ](map:)')).toContain('href="map:"');
  });

  it('produces a URL the app sanitizer keeps', () => {
    const url = buildMapUrl('123 Main St');
    expect(safeUrlTransform(url)).toBe(url);
    // An unconverted map: link is dropped by the sanitizer.
    expect(safeUrlTransform('map:')).toBe('');
  });
});
