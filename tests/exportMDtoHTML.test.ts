/**
 * Autogen HTML (front matter `autogen.outputFile`) tests: the `|||` column layout.
 */
import { describe, it, expect } from 'vitest';
import { convertMDtoHTML } from '../src/shared/exportMDtoHTML';

describe('convertMDtoHTML columns', () => {
  it('renders a single chunk without a column row', async () => {
    const html = await convertMDtoHTML('just one\n');
    expect(html).toContain('<main>');
    expect(html).not.toContain('<div class="columns"');
  });

  it('splits ||| into one column element per chunk', async () => {
    const html = await convertMDtoHTML('a\n|||\nb\n|||\nc\n');
    expect(html).toContain('<div class="columns">');
    expect(html.match(/<div class="col">/g)).toHaveLength(3);
  });

  it('stacks columns by default and widens them at the sm and lg breakpoints', async () => {
    const html = await convertMDtoHTML('a\n|||\nb\n');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    expect(html).toMatch(/\.columns \{[^}]*flex-wrap: wrap;/);
    expect(html).toMatch(/\.col \{[^}]*flex: 1 1 100%;[^}]*max-width: 100%;/);
    expect(html).toMatch(/@media \(min-width: 640px\) \{\s*\.col \{ flex-basis: calc\(50% - 1rem\); \}/);
    expect(html).toMatch(/@media \(min-width: 1024px\) \{\s*\.col \{ flex-basis: 0; \}/);
  });
});
