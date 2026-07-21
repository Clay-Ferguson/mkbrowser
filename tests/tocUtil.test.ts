import { describe, it, expect } from 'vitest';
import { removeTOC, processTOC, extractHeadingTree } from '../src/shared/tocUtil';

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

  it('strips every TOC block when multiple are present', () => {
    const input =
      '<!-- TOC -->\n- [a](#a)\n<!-- /TOC -->\nmid\n<!-- TOC -->\n- [b](#b)\n<!-- /TOC -->';
    expect(removeTOC(input)).toBe('<!-- TOC -->\nmid\n<!-- TOC -->');
  });

  it('collapses an empty TOC body (adjacent tags)', () => {
    const input = '<!-- TOC -->\n<!-- /TOC -->';
    expect(removeTOC(input)).toBe('<!-- TOC -->');
  });

  it('leaves TOC tags inside a fenced code block untouched', () => {
    const input = '# Title\n\n```md\n<!-- TOC -->\nexample\n<!-- /TOC -->\n```\n\nReal user prose here.\n';
    expect(removeTOC(input)).toBe(input);
  });

  it('does not swallow prose between a fenced start tag and a real end tag', () => {
    const input =
      '# Title\n\n```md\n<!-- TOC -->\n```\n\nReal user prose here.\n\n<!-- /TOC -->\n\nMore prose.\n';
    expect(removeTOC(input)).toBe(input);
  });

  it('ignores an inline TOC tag sharing a line with prose', () => {
    const input = 'The <!-- TOC --> tag expands to a list.\n\nDone. <!-- /TOC -->\n';
    expect(removeTOC(input)).toBe(input);
  });

  it('leaves an unmatched opening tag as written', () => {
    const input = '# Title\n\n<!-- TOC -->\n\n## Alpha\n';
    expect(removeTOC(input)).toBe(input);
  });

  it('collapses a real TOC block that follows a documented one in a fence', () => {
    const input =
      '# Title\n\n```md\n<!-- TOC -->\n<!-- /TOC -->\n```\n\n<!-- TOC -->\n- [Alpha](#alpha)\n<!-- /TOC -->\n\n## Alpha\n';
    expect(removeTOC(input)).toBe(
      '# Title\n\n```md\n<!-- TOC -->\n<!-- /TOC -->\n```\n\n<!-- TOC -->\n\n## Alpha\n'
    );
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

  it('includes the first heading (document title) in generated TOC', async () => {
    const content = '# My Doc\n\n<!-- TOC -->\n\n## Section One\n\n## Section Two\n';
    const result = await processTOC(content);
    // The title heading is a real entry, with the H2s nested beneath it
    const tocSection = result.slice(result.indexOf('<!-- TOC -->'), result.indexOf('<!-- /TOC -->'));
    expect(tocSection).toContain('[My Doc](#my-doc)');
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

  it('does not treat an inline <!-- TOC --> in prose as a placeholder', async () => {
    const content = '# Title\n\nSome prose with <!-- TOC --> in the middle.\n\n## Alpha\n';
    expect(await processTOC(content)).toBe(content);
  });

  it('includes deep headings up to H6 (maxDepth 6)', async () => {
    const content = '# Title\n\n<!-- TOC -->\n\n## A\n\n### B\n\n#### C\n\n##### D\n\n###### E\n';
    const result = await processTOC(content);
    const tocSection = result.slice(result.indexOf('<!-- TOC -->'), result.indexOf('<!-- /TOC -->'));
    expect(tocSection).toContain('](#a)');
    expect(tocSection).toContain('](#b)');
    expect(tocSection).toContain('](#c)');
    expect(tocSection).toContain('](#d)');
    expect(tocSection).toContain('](#e)');
  });

  it('ignores headings inside tilde-fenced code blocks', async () => {
    const content = '# Title\n\n<!-- TOC -->\n\n## Real Section\n\n~~~\n## Fake Heading\n~~~\n';
    const result = await processTOC(content);
    const tocSection = result.slice(result.indexOf('<!-- TOC -->'), result.indexOf('<!-- /TOC -->'));
    expect(tocSection).toContain('Real Section');
    expect(tocSection).not.toContain('Fake Heading');
  });

  it('does not treat a fenced end tag as the closing tag (would eat user content)', async () => {
    const content =
      '# Title\n\n<!-- TOC -->\n\n## Alpha\n\nHere is how the block ends:\n\n```md\n<!-- /TOC -->\n```\n\n## Beta\n';
    const result = await processTOC(content);
    // Everything after the placeholder must survive: the fence, its contents, and Beta.
    expect(result).toContain('Here is how the block ends:');
    expect(result).toContain('```md\n<!-- /TOC -->\n```');
    expect(result).toContain('## Beta');
    // The generated block is closed with its own end tag right after the list.
    const tocSection = result.slice(result.indexOf('<!-- TOC -->'), result.indexOf('<!-- /TOC -->'));
    expect(tocSection).toContain('](#alpha)');
    expect(tocSection).toContain('](#beta)');
  });

  it('ignores TOC placeholders inside code fences', async () => {
    const content = '# Title\n\n```md\n<!-- TOC -->\n<!-- /TOC -->\n```\n\n## Alpha\n';
    expect(await processTOC(content)).toBe(content);
  });

  it('locates the real placeholder when a fenced one appears first', async () => {
    const content =
      '# Title\n\n```md\n<!-- TOC -->\n```\n\n<!-- TOC -->\n\n## Alpha\n\n## Beta\n';
    const result = await processTOC(content);
    // The fenced sample is untouched and stays an empty placeholder line.
    expect(result).toContain('```md\n<!-- TOC -->\n```');
    // The real placeholder (the one after the fence) got the generated list.
    const realStart = result.indexOf('<!-- TOC -->', result.indexOf('```md'));
    const tocSection = result.slice(realStart, result.indexOf('<!-- /TOC -->'));
    expect(tocSection).toContain('](#alpha)');
    expect(tocSection).toContain('](#beta)');
  });

  it('does not treat an end tag before the placeholder as the closing tag', async () => {
    const content = '# Title\n\n<!-- /TOC -->\n\n<!-- TOC -->\n\n## Alpha\n';
    const result = await processTOC(content);
    const startIdx = result.indexOf('<!-- TOC -->');
    expect(result.indexOf('](#alpha)')).toBeGreaterThan(startIdx);
    expect(result.split('<!-- /TOC -->').length - 1).toBe(2); // the stray one, plus the new closing tag
  });

  it('regenerates a TOC written with spacing variants in the tags', async () => {
    const content = '# Title\n\n<!--  TOC  -->\n- [Old](#old)\n<!--  /TOC  -->\n\n## Alpha\n';
    const result = await processTOC(content);
    expect(result).not.toContain('[Old]');
    expect(result).toContain('](#alpha)');
  });

  it('round-trips with removeTOC: editor load then save restores the TOC', async () => {
    // `*` is the bullet remark-stringify emits, so this is a fixed point of processTOC.
    const original =
      '# Title\n\n<!-- TOC -->\n* [Title](#title)\n  * [Alpha](#alpha)\n<!-- /TOC -->\n\n## Alpha\n';
    const edited = removeTOC(original);
    expect(edited).toBe('# Title\n\n<!-- TOC -->\n\n## Alpha\n');
    expect(await processTOC(edited)).toBe(original);
  });
});

describe('extractHeadingTree', () => {
  it('returns empty array for content with no headings', () => {
    expect(extractHeadingTree('file.md', 'just text')).toEqual([]);
  });

  it('returns the leading H1 as the root with the H2s beneath it', () => {
    const content = '# Title\n\n## Alpha\n\n## Beta\n';
    const tree = extractHeadingTree('file.md', content);
    expect(tree.map(n => n.heading)).toEqual(['Title']);
    expect(tree[0].children?.map(n => n.heading)).toEqual(['Alpha', 'Beta']);
  });

  it('builds nested children for deeper headings', () => {
    const content = '# Title\n\n## Section\n\n### Sub\n';
    const tree = extractHeadingTree('file.md', content);
    expect(tree).toHaveLength(1);
    expect(tree[0].heading).toBe('Title');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children?.[0].heading).toBe('Section');
    expect(tree[0].children?.[0].children?.[0].heading).toBe('Sub');
  });

  it('assigns correct depth values', () => {
    const content = '# Title\n\n## H2\n\n### H3\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree[0].depth).toBe(1);
    expect(tree[0].children?.[0].depth).toBe(2);
    expect(tree[0].children?.[0].children?.[0].depth).toBe(3);
  });

  it('generates slugs for headings', () => {
    const content = '# Title\n\n## Hello World\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree[0].slug).toBe('title');
    expect(tree[0].children?.[0].slug).toBe('hello-world');
  });

  it('sets path using filePath and flat index', () => {
    const content = '# Title\n\n## Alpha\n\n## Beta\n';
    const tree = extractHeadingTree('notes/file.md', content);
    expect(tree[0].path).toBe('notes/file.md#0');
    expect(tree[0].children?.[0].path).toBe('notes/file.md#1');
    expect(tree[0].children?.[1].path).toBe('notes/file.md#2');
  });

  it('ignores headings inside fenced code blocks', () => {
    // ## Fake lives in a code block and is excluded
    const content = '# Title\n\n## Real\n\n```\n## Fake\n```\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree.map(n => n.heading)).toEqual(['Title']);
    expect(tree[0].children?.map(n => n.heading)).toEqual(['Real']);
  });

  it('ignores headings in front matter', () => {
    const content = '---\ntitle: X\n---\n\n## Section\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree.map(n => n.heading)).toEqual(['Section']);
  });

  it('handles multiple root-level headings (no parent)', () => {
    // Same-depth H1s are all roots, each with no children
    const content = '# A\n\n# B\n\n# C\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree).toHaveLength(3);
    tree.forEach(n => expect(n.children).toBeNull());
  });

  it('pops the stack so a sibling after nesting returns to the root level', () => {
    // ## A has child ### A1; ## B is a sibling of A with no children
    const content = '# Title\n\n## A\n\n### A1\n\n## B\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree.map(n => n.heading)).toEqual(['Title']);
    expect(tree[0].children?.map(n => n.heading)).toEqual(['A', 'B']);
    expect(tree[0].children?.[0].children?.map(n => n.heading)).toEqual(['A1']);
    expect(tree[0].children?.[1].children).toBeNull();
  });

  it('retains headings deeper than H3 (no maxDepth cap)', () => {
    // Unlike processTOC (maxDepth 3), the tree keeps H4 and beyond
    const content = '# Title\n\n## A\n\n### B\n\n#### C\n';
    const tree = extractHeadingTree('f.md', content);
    const a = tree[0].children?.[0];
    expect(a?.heading).toBe('A');
    expect(a?.children?.[0].heading).toBe('B');
    expect(a?.children?.[0].children?.[0].heading).toBe('C');
    expect(a?.children?.[0].children?.[0].depth).toBe(4);
  });

  it('ignores headings inside tilde-fenced code blocks', () => {
    const content = '# Title\n\n## Real\n\n~~~\n## Fake\n~~~\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree.map(n => n.heading)).toEqual(['Title']);
    expect(tree[0].children?.map(n => n.heading)).toEqual(['Real']);
  });

  it('attaches a deeper heading directly under a shallower ancestor (skipped level)', () => {
    // ## A then #### Deep (no H3 between) attaches Deep directly under A
    const content = '# Title\n\n## A\n\n#### Deep\n';
    const tree = extractHeadingTree('f.md', content);
    expect(tree).toHaveLength(1);
    const a = tree[0].children?.[0];
    expect(a?.heading).toBe('A');
    expect(a?.children?.[0].heading).toBe('Deep');
    expect(a?.children?.[0].depth).toBe(4);
  });
});
