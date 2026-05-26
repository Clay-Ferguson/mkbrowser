import { describe, it, expect } from 'vitest';
import { removeTOC, processTOC, extractHeadingTree } from '../src/utils/tocUtil';

describe('removeTOC', () => {
  it('strips TOC body leaving only the opening tag', () => {
    const input = '<!-- TOC -->\n- [Foo](#foo)\n- [Bar](#bar)\n<!-- /TOC -->';
    expect(removeTOC(input)).toBe('<!-- TOC -->');
  });

  it('leaves content without TOC tags unchanged', () => {
    const input = '# Hello\nsome text';
    expect(removeTOC(input)).toBe(input);
  });

  it('handles whitespace variants in tags', () => {
    const input = '<!--  TOC  -->\n- [x](#x)\n<!--  /TOC  -->';
    expect(removeTOC(input)).toBe('<!-- TOC -->');
  });

  it('preserves content before and after TOC block', () => {
    const input = 'before\n<!-- TOC -->\n- [x](#x)\n<!-- /TOC -->\nafter';
    expect(removeTOC(input)).toBe('before\n<!-- TOC -->\nafter');
  });
});

describe('processTOC', () => {
  it('returns content unchanged when no TOC tag is present', async () => {
    const content = '# Title\n\n## Section\n\nsome text';
    expect(await processTOC(content)).toBe(content);
  });

  it('returns content unchanged when multiple TOC tags are present', async () => {
    const content = '<!-- TOC -->\n<!-- TOC -->\n# Title\n## Section';
    expect(await processTOC(content)).toBe(content);
  });

  it('returns content unchanged when no headings exist', async () => {
    const content = '<!-- TOC -->\nno headings here';
    expect(await processTOC(content)).toBe(content);
  });

  it('inserts TOC and adds closing tag when only opening tag is present', async () => {
    const content = '# Title\n\n<!-- TOC -->\n\n## Alpha\n\n## Beta\n';
    const result = await processTOC(content);
    expect(result).toContain('<!-- TOC -->');
    expect(result).toContain('<!-- /TOC -->');
    expect(result).toContain('Alpha');
    expect(result).toContain('Beta');
  });

  it('replaces existing TOC body when both tags are present', async () => {
    const content = '# Title\n\n<!-- TOC -->\n- [Old](#old)\n<!-- /TOC -->\n\n## Alpha\n\n## Beta\n';
    const result = await processTOC(content);
    expect(result).not.toContain('[Old]');
    expect(result).toContain('Alpha');
    expect(result).toContain('Beta');
    // Exactly one closing tag
    expect(result.split('<!-- /TOC -->').length - 1).toBe(1);
  });

  it('skips the first heading (document title) in generated TOC', async () => {
    const content = '# My Doc\n\n<!-- TOC -->\n\n## Section One\n\n## Section Two\n';
    const result = await processTOC(content);
    // The original heading still appears in the document body, but the TOC links should not reference it
    const tocSection = result.slice(result.indexOf('<!-- TOC -->'), result.indexOf('<!-- /TOC -->'));
    expect(tocSection).not.toContain('[My Doc]');
    expect(result).toContain('Section One');
    expect(result).toContain('Section Two');
  });

  it('ignores headings inside fenced code blocks', async () => {
    const content = '# Title\n\n<!-- TOC -->\n\n## Real Section\n\n```\n## Fake Heading\n```\n';
    const result = await processTOC(content);
    const tocSection = result.slice(result.indexOf('<!-- TOC -->'), result.indexOf('<!-- /TOC -->'));
    expect(tocSection).toContain('Real Section');
    expect(tocSection).not.toContain('Fake Heading');
  });

  it('ignores headings in front matter', async () => {
    const content = '---\ntitle: My Doc\n---\n\n# Title\n\n<!-- TOC -->\n\n## Section\n';
    const result = await processTOC(content);
    const tocSection = result.slice(result.indexOf('<!-- TOC -->'), result.indexOf('<!-- /TOC -->'));
    expect(tocSection).toContain('Section');
    expect(tocSection).not.toContain('My Doc');
  });
});

describe('extractHeadingTree', () => {
  it('returns empty array for content with no headings', () => {
    expect(extractHeadingTree('file.md', 'just text')).toEqual([]);
  });

  it('returns flat list of H2+ headings skipping the first H1', () => {
    const content = '# Title\n\n## Alpha\n\n## Beta\n';
    const tree = extractHeadingTree('file.md', content);
    expect(tree.map(n => n.heading)).toEqual(['Alpha', 'Beta']);
  });

  it('builds nested children for deeper headings', () => {
    const content = '# Title\n\n## Section\n\n### Sub\n';
    const tree = extractHeadingTree('file.md', content);
    expect(tree).toHaveLength(1);
    expect(tree[0].heading).toBe('Section');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children![0].heading).toBe('Sub');
  });

  it('assigns correct depth values', () => {
    // First heading (# Title) is skipped; ## H2 and ### H3 are retained
    const content = '# Title\n\n## H2\n\n### H3\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree[0].depth).toBe(2);
    expect(tree[0].children![0].depth).toBe(3);
  });

  it('generates slugs for headings', () => {
    // First heading skipped; ## Hello World is the first retained heading
    const content = '# Title\n\n## Hello World\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree[0].slug).toBe('hello-world');
  });

  it('sets path using filePath and flat index', () => {
    // First heading (# Title, flat index 0) is skipped by sanitizeForTOC
    const content = '# Title\n\n## Alpha\n\n## Beta\n';
    const tree = extractHeadingTree('notes/file.md', content);
    expect(tree[0].path).toBe('notes/file.md#0');
    expect(tree[1].path).toBe('notes/file.md#1');
  });

  it('ignores headings inside fenced code blocks', () => {
    // First heading (# Title) skipped; ## Real retained; ## Fake in code block excluded
    const content = '# Title\n\n## Real\n\n```\n## Fake\n```\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree.map(n => n.heading)).toEqual(['Real']);
  });

  it('ignores headings in front matter', () => {
    const content = '---\ntitle: X\n---\n\n## Section\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree.map(n => n.heading)).toEqual(['Section']);
  });

  it('handles multiple root-level headings (no parent)', () => {
    // First heading (# Title) skipped; A, B, C are all roots
    const content = '# Title\n\n## A\n\n## B\n\n## C\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree).toHaveLength(3);
    tree.forEach(n => expect(n.children).toBeNull());
  });
});
