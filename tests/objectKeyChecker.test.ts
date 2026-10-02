/**
 * Unknown properties in object blocks: which keys are reported, and where the editor finds
 * them in a Markdown document.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { findTopLevelKeys } from '../src/shared/objects/objectBlock';
import { unknownObjectKeys } from '../src/components/objects/objectRegistry';
import { unknownObjectKeysInRange } from '../src/components/editor/objectKeyChecker';
import { fencedCodeLanguage } from '../src/renderer/editor/editorCodeLanguages';

// ---------------------------------------------------------------------------
// findTopLevelKeys
// ---------------------------------------------------------------------------

describe('findTopLevelKeys', () => {
  /** The located keys, each as the exact text its range covers. */
  const located = (code: string) => findTopLevelKeys(code).map(({ key, from, to }) => [key, code.slice(from, to)]);

  it('locates each key at the start of a line', () => {
    expect(located('type: person\nfirst_name: Clay\nemail:')).toEqual([
      ['type', 'type'],
      ['first_name', 'first_name'],
      ['email', 'email'],
    ]);
  });

  it('skips indented lines: block scalar bodies, nested mappings and list items', () => {
    const code = 'address: |\n  street: 1 Main St\n  city: Dallas\nnested:\n  inner: 1\nlist:\n  - a: 1\nlast: x';
    expect(located(code).map(([key]) => key)).toEqual(['address', 'nested', 'list', 'last']);
  });

  it('covers the quotes of a quoted key but reports the key without them', () => {
    expect(located('"full name": Clay\n\'nick\': C')).toEqual([
      ['full name', '"full name"'],
      ['nick', "'nick'"],
    ]);
  });

  it('allows spaces before the colon and stops at the first colon', () => {
    expect(located('web site : http://example.com')).toEqual([['web site', 'web site']]);
  });

  it('ignores comments, blank lines, document markers and flow syntax', () => {
    expect(located('# note: x\n\n---\n{a: 1}\n- item: 1\nplain text')).toEqual([]);
  });

  it('does not treat a colon without a following space as a key', () => {
    expect(located('time:12:30\nurl:http://x')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// unknownObjectKeys
// ---------------------------------------------------------------------------

describe('unknownObjectKeys', () => {
  const keys = (code: string, language = 'yaml') => unknownObjectKeys(language, code).map(({ key }) => key);

  it('reports nothing for a person with only known properties', () => {
    expect(keys('type: person\nfirst_name: Clay\nlast_name: Ferguson\ncell_phone: 1\nother_phone: 2\nemail: a@b.c\naddress: x')).toEqual([]);
  });

  it('reports a misspelled property with its position and type', () => {
    const code = 'type: person\nfrist_name: Clay\nlast_name: Ferguson';
    const found = unknownObjectKeys('yaml', code);
    expect(found).toEqual([{ key: 'frist_name', from: 13, to: 23, type: 'person' }]);
    expect(code.slice(13, 23)).toBe('frist_name');
  });

  it('reports every unknown property, in document order', () => {
    expect(keys('nickname: C\ntype: person\nfirst_name: Clay\ntags: [a, b]\nzip: 75001')).toEqual(['nickname', 'tags', 'zip']);
  });

  it('never reports type itself', () => {
    expect(keys('type: person')).toEqual([]);
  });

  it('is case-sensitive about property names', () => {
    expect(keys('type: person\nFirst_Name: Clay')).toEqual(['First_Name']);
  });

  it('reports an unknown property even when it has no value yet', () => {
    expect(keys('type: person\nfirst_name: Clay\nnickname:')).toEqual(['nickname']);
  });

  it('does not report text inside a multi-line value', () => {
    expect(keys('type: person\naddress: |\n  suite: 100\n  city: Dallas')).toEqual([]);
  });

  it.each([
    ['an unregistered type', 'type: gadget\nwhatever: 1', 'yaml'],
    ['yaml with no type', 'frist_name: Clay', 'yaml'],
    ['malformed yaml', 'type: person\nfrist_name: [x', 'yaml'],
    ['a non-yaml block', 'type: person\nfrist_name: Clay', 'json'],
  ])('reports nothing for %s', (_label, code, language) => {
    expect(keys(code, language)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// unknownObjectKeysInRange (the editor's view of a whole Markdown document)
// ---------------------------------------------------------------------------

/** Parses `doc` as the editor does and returns the flagged keys as the exact text they cover. */
function flagged(doc: string, from = 0, to = doc.length): string[] {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, codeLanguages: fencedCodeLanguage })],
  });
  if (!ensureSyntaxTree(state, doc.length, 5000)) throw new Error('parse did not finish');
  return unknownObjectKeysInRange(state, from, to).map((key) => {
    expect(key.type).toBe('person');
    return doc.slice(key.from, key.to);
  });
}

const block = (body: string, info = 'yaml') => `\`\`\`${info}\n${body}\n\`\`\``;

describe('unknownObjectKeysInRange', () => {
  it('flags an unknown property inside a person block', () => {
    expect(flagged(`# Title\n\n${block('type: person\nfrist_name: Clay\nemail: a@b.c')}\n\nafter`)).toEqual(['frist_name']);
  });

  it('flags nothing in a correct person block', () => {
    expect(flagged(block('type: person\nfirst_name: Clay'))).toEqual([]);
  });

  it('handles several blocks in one document', () => {
    const doc = [
      block('type: person\nnick: C'),
      'text',
      block('type: gadget\nwhatever: 1'),
      block('type: person\nfirst_name: Clay'),
      block('type: person\nzip: 1\ntown: X', 'yml'),
    ].join('\n\n');
    expect(flagged(doc)).toEqual(['nick', 'zip', 'town']);
  });

  it('ignores non-yaml and untagged blocks', () => {
    expect(flagged(`${block('type: person\nnick: C', 'json')}\n\n${block('type: person\nnick: C', '')}`)).toEqual([]);
  });

  it('ignores yaml-looking text outside a fence', () => {
    expect(flagged('type: person\nnick: C')).toEqual([]);
  });

  it('ignores an unclosed fence', () => {
    expect(flagged('```yaml\ntype: person\nnick: C\n\nmore text')).toEqual([]);
  });

  it('ignores a block with no body', () => {
    expect(flagged('```yaml\n```')).toEqual([]);
  });

  it('finds keys in a fence indented inside a list item', () => {
    const doc = '- item\n\n  ```yaml\n  type: person\n  nick: C\n  address: |\n    suite: 100\n  ```\n';
    expect(flagged(doc)).toEqual(['nick']);
  });

  it('only reports blocks that intersect the requested range', () => {
    const first = block('type: person\nnick: C');
    const doc = `${first}\n\ntext\n\n${block('type: person\nzip: 1')}`;
    expect(flagged(doc, 0, first.length)).toEqual(['nick']);
    expect(flagged(doc, doc.length - 5, doc.length)).toEqual(['zip']);
  });

  it('leaves front matter alone', () => {
    expect(flagged('---\ntype: person\nnick: C\n---\n\nbody')).toEqual([]);
  });
});
