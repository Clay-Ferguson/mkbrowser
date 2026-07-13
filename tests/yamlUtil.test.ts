/**
 * loadYaml tests — js-yaml 5 throws `expected a document, but the input is
 * empty` where v4 returned `undefined`. Callers here treat a nullish parse as
 * "no data, carry on" but a throw as "malformed, refuse to touch the file", so
 * that change would turn empty (but perfectly valid) front matter into a
 * refusal: tags silently not added, properties silently not written, and the
 * user warned their YAML is corrupt. loadYaml restores the v4 contract, and
 * these tests pin both halves of it — empty parses to undefined, genuinely
 * malformed YAML still throws.
 */
import { describe, it, expect } from 'vitest';
import { loadYaml } from '../src/shared/yamlUtil';

describe('loadYaml', () => {
  describe('empty documents parse to undefined rather than throwing', () => {
    it.each([
      ['empty string', ''],
      ['whitespace only', '   \n  \t\n'],
      ['a single comment', '# nothing here yet\n'],
      ['several comments and blank lines', '# one\n\n#two\n   # three\n'],
      ['an indented comment', '   # indented\n'],
    ])('%s', (_label, input) => {
      expect(loadYaml(input)).toBeUndefined();
    });
  });

  it('parses a normal mapping', () => {
    expect(loadYaml('title: Hi\ntags:\n  - a\n  - b\n')).toEqual({ title: 'Hi', tags: ['a', 'b'] });
  });

  it('keeps trailing comments on an otherwise non-empty document', () => {
    expect(loadYaml('key: 1\n# trailing\n')).toEqual({ key: 1 });
  });

  it('does not mistake a comment inside a block scalar for an empty document', () => {
    // The emptiness check strips whole comment lines, but only to decide whether
    // to parse — the real parse still sees the block scalar verbatim.
    expect(loadYaml('body: |\n  # a markdown heading\n  text\n')).toEqual({
      body: '# a markdown heading\ntext\n',
    });
  });

  it('still throws on malformed YAML', () => {
    expect(() => loadYaml('key: [unclosed\n')).toThrow();
  });

  it('still throws on duplicate mapping keys', () => {
    // Load-bearing: the tag/front-matter editors use this throw to refuse an
    // edit that would otherwise silently drop one of the duplicated keys.
    expect(() => loadYaml('dup: 1\ndup: 2\n')).toThrow();
  });
});
