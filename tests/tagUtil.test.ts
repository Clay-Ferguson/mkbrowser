import { describe, it, expect } from 'vitest';
import { load } from 'js-yaml';
import {
  tagName,
  getTagsFromYaml,
  isYamlParseable,
  setTagsInYaml,
  removeTagFromText,
  insertTagIntoText,
  serializeTagsToYaml,
  type TagCategory,
} from '../src/shared/tagUtil';

describe('tagName', () => {
  it('strips a leading # from a hashtag', () => {
    expect(tagName('#cooking')).toBe('cooking');
  });

  it('returns the input unchanged when there is no leading #', () => {
    expect(tagName('cooking')).toBe('cooking');
  });

  it('only strips the first # (preserves later ones)', () => {
    expect(tagName('##double')).toBe('#double');
  });

  it('returns an empty string for a bare #', () => {
    expect(tagName('#')).toBe('');
  });

  it('returns an empty string for empty input', () => {
    expect(tagName('')).toBe('');
  });

  it('does not strip a # that appears mid-string', () => {
    expect(tagName('foo#bar')).toBe('foo#bar');
  });
});

describe('getTagsFromYaml', () => {
  it('returns the list of string tags', () => {
    expect(getTagsFromYaml('tags:\n  - foo\n  - bar')).toEqual(['foo', 'bar']);
  });

  it('returns an empty array when there is no tags key', () => {
    expect(getTagsFromYaml('title: hello')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(getTagsFromYaml('')).toEqual([]);
  });

  it('returns an empty array for malformed YAML', () => {
    expect(getTagsFromYaml('tags: : : not valid')).toEqual([]);
  });

  it('returns an empty array when tags is not an array', () => {
    expect(getTagsFromYaml('tags: justastring')).toEqual([]);
  });

  it('returns an empty array when the document parses to null', () => {
    expect(getTagsFromYaml('null')).toEqual([]);
  });

  it('filters out non-string entries in the tags array', () => {
    expect(getTagsFromYaml('tags:\n  - foo\n  - 42\n  - true\n  - bar')).toEqual(['foo', 'bar']);
  });

  it('returns an empty array for an empty tags list', () => {
    expect(getTagsFromYaml('tags: []')).toEqual([]);
  });
});

describe('isYamlParseable', () => {
  it('returns true for valid YAML', () => {
    expect(isYamlParseable('title: hello\ntags:\n  - foo')).toBe(true);
  });

  it('returns true for empty input', () => {
    expect(isYamlParseable('')).toBe(true);
  });

  it('returns false for malformed YAML', () => {
    expect(isYamlParseable('this: : : not valid')).toBe(false);
  });

  it('returns false for duplicate mapping keys', () => {
    expect(isYamlParseable('due: 1/1/25\ndue: 2/2/25')).toBe(false);
  });
});

describe('setTagsInYaml', () => {
  it('writes a sorted tags list', () => {
    expect(setTagsInYaml('', ['banana', 'apple', 'cherry'])).toBe(
      'tags:\n  - apple\n  - banana\n  - cherry\n'
    );
  });

  it('sorts case-insensitively via localeCompare', () => {
    expect(getTagsFromYaml(setTagsInYaml('', ['Zebra', 'apple', 'Mango']))).toEqual([
      'apple',
      'Mango',
      'Zebra',
    ]);
  });

  it('does not mutate the input tags array', () => {
    const tags = ['b', 'a'];
    setTagsInYaml('', tags);
    expect(tags).toEqual(['b', 'a']);
  });

  it('preserves other existing properties', () => {
    const result = setTagsInYaml('title: hello\ncount: 3', ['foo']);
    expect(load(result)).toEqual({ title: 'hello', count: 3, tags: ['foo'] });
  });

  it('removes the tags key when given an empty list', () => {
    const result = setTagsInYaml('title: hello\ntags:\n  - foo', []);
    expect(load(result)).toEqual({ title: 'hello' });
  });

  it('returns an empty string when removing tags leaves no properties', () => {
    expect(setTagsInYaml('tags:\n  - foo', [])).toBe('');
  });

  it('returns an empty string for empty input and no tags', () => {
    expect(setTagsInYaml('', [])).toBe('');
  });

  it('returns unparseable YAML unchanged rather than discarding it', () => {
    // Refusing to edit protects front matter js-yaml can't parse (e.g. malformed
    // syntax or duplicate keys) from being silently wiped.
    const input = 'this: : : not valid';
    expect(setTagsInYaml(input, ['foo'])).toBe(input);
  });

  it('returns YAML with duplicate keys unchanged (js-yaml rejects duplicates)', () => {
    const input = 'due: 1/1/25\ndue: 2/2/25\nimportant: stuff';
    expect(setTagsInYaml(input, ['work'])).toBe(input);
  });

  it('overwrites an existing tags list', () => {
    const result = setTagsInYaml('tags:\n  - old', ['new']);
    expect(getTagsFromYaml(result)).toEqual(['new']);
  });

  it('round-trips through getTagsFromYaml in sorted order', () => {
    const result = setTagsInYaml('', ['gamma', 'alpha', 'beta']);
    expect(getTagsFromYaml(result)).toEqual(['alpha', 'beta', 'gamma']);
  });
});

describe('removeTagFromText', () => {
  it('removes a tag from front matter, accepting a #-prefixed tag', () => {
    const text = '---\ntags:\n  - foo\n  - bar\n---\nbody';
    const result = removeTagFromText(text, '#foo');
    expect(result).toBe('---\ntags:\n  - bar\n---\nbody');
  });

  it('removes a tag given without a # prefix', () => {
    const text = '---\ntags:\n  - foo\n  - bar\n---\nbody';
    const result = removeTagFromText(text, 'foo');
    expect(result).toContain('- bar');
    expect(result).not.toContain('- foo');
  });

  it('drops the front matter entirely when removing the only tag', () => {
    const text = '---\ntags:\n  - foo\n---\nbody';
    expect(removeTagFromText(text, '#foo')).toBe('body');
  });

  it('returns the text unchanged when there is no front matter', () => {
    const text = 'just a plain body with #foo in it';
    expect(removeTagFromText(text, '#foo')).toBe(text);
  });

  it('leaves the tags list intact when the tag is absent', () => {
    const text = '---\ntags:\n  - foo\n---\nbody';
    const result = removeTagFromText(text, '#missing');
    expect(result).toBe(text);
  });

  it('preserves other front matter properties when removing a tag', () => {
    const text = '---\ntitle: Doc\ntags:\n  - foo\n---\nbody';
    const result = removeTagFromText(text, '#foo');
    expect(result).toContain('title: Doc');
    expect(result.endsWith('body')).toBe(true);
  });

  it('does not wipe front matter js-yaml cannot parse (duplicate keys)', () => {
    const text = '---\ndue: 1/1/25\ndue: 2/2/25\nimportant: stuff\n---\nbody\n';
    expect(removeTagFromText(text, '#work')).toBe(text);
  });
});

describe('insertTagIntoText', () => {
  it('adds front matter to a plain body', () => {
    expect(insertTagIntoText('hello world', '#foo')).toBe('---\ntags:\n  - foo\n---\nhello world');
  });

  it('strips the # prefix before inserting', () => {
    expect(insertTagIntoText('body', '#cooking')).toBe('---\ntags:\n  - cooking\n---\nbody');
  });

  it('accepts a tag without a # prefix', () => {
    expect(insertTagIntoText('body', 'cooking')).toBe('---\ntags:\n  - cooking\n---\nbody');
  });

  it('appends to an existing tags list and keeps it sorted', () => {
    const text = '---\ntags:\n  - bbb\n---\nbody';
    const result = insertTagIntoText(text, '#aaa');
    expect(getTagsFromYaml(result.replace(/^---\n([\s\S]*?)\n---[\s\S]*$/, '$1'))).toEqual([
      'aaa',
      'bbb',
    ]);
  });

  it('is a no-op when the tag already exists', () => {
    const text = '---\ntags:\n  - foo\n---\nbody';
    expect(insertTagIntoText(text, '#foo')).toBe(text);
  });

  it('is a no-op for an existing tag given without a # prefix', () => {
    const text = '---\ntags:\n  - foo\n---\nbody';
    expect(insertTagIntoText(text, 'foo')).toBe(text);
  });

  it('preserves other front matter properties', () => {
    const text = '---\ntitle: Doc\n---\nbody';
    const result = insertTagIntoText(text, '#foo');
    expect(result).toContain('title: Doc');
    expect(result).toContain('- foo');
    expect(result.endsWith('body')).toBe(true);
  });

  it('round-trips: a removed tag can be re-inserted to the original', () => {
    const original = '---\ntags:\n  - foo\n---\nbody';
    const removed = removeTagFromText(original, '#foo');
    expect(insertTagIntoText(removed, '#foo')).toBe(original);
  });

  it('does not wipe front matter js-yaml cannot parse (duplicate keys)', () => {
    const text = '---\ndue: 1/1/25\ndue: 2/2/25\nimportant: stuff\n---\nbody\n';
    expect(insertTagIntoText(text, '#work')).toBe(text);
  });
});

describe('serializeTagsToYaml', () => {
  it('serializes a category with tags into the canonical hashtags structure', () => {
    const categories: TagCategory[] = [
      { name: 'Food', tags: [{ tag: '#cooking', description: 'About food' }] },
    ];
    const yaml = serializeTagsToYaml(categories);
    expect(load(yaml)).toEqual({
      hashtags: { Food: { cooking: { description: 'About food\n' } } },
    });
  });

  it('strips the # prefix from tag names', () => {
    const categories: TagCategory[] = [
      { name: 'C', tags: [{ tag: '#x', description: 'd' }] },
    ];
    const parsed = load(serializeTagsToYaml(categories)) as {
      hashtags: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(parsed.hashtags.C)).toEqual(['x']);
  });

  it('uses a bare newline description for an empty description', () => {
    const categories: TagCategory[] = [
      { name: 'C', tags: [{ tag: '#x', description: '' }] },
    ];
    expect(load(serializeTagsToYaml(categories))).toEqual({
      hashtags: { C: { x: { description: '\n' } } },
    });
  });

  it('trims surrounding whitespace from the description', () => {
    const categories: TagCategory[] = [
      { name: 'C', tags: [{ tag: '#x', description: '  spaced  ' }] },
    ];
    expect(load(serializeTagsToYaml(categories))).toEqual({
      hashtags: { C: { x: { description: 'spaced\n' } } },
    });
  });

  it('serializes an empty category to an empty map', () => {
    const categories: TagCategory[] = [{ name: 'Empty', tags: [] }];
    expect(load(serializeTagsToYaml(categories))).toEqual({
      hashtags: { Empty: {} },
    });
  });

  it('serializes multiple categories', () => {
    const categories: TagCategory[] = [
      { name: 'A', tags: [{ tag: '#a1', description: 'one' }] },
      { name: 'B', tags: [{ tag: '#b1', description: 'two' }] },
    ];
    expect(load(serializeTagsToYaml(categories))).toEqual({
      hashtags: {
        A: { a1: { description: 'one\n' } },
        B: { b1: { description: 'two\n' } },
      },
    });
  });

  it('serializes an empty category list to an empty hashtags map', () => {
    expect(load(serializeTagsToYaml([]))).toEqual({ hashtags: {} });
  });
});
