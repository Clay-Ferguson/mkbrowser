import { describe, it, expect } from 'vitest';
import {
  splitFrontMatter,
  parseFrontMatter,
  assembleFrontMatter,
  getPropsFromYaml,
  setFrontMatterProperty,
} from '../src/shared/frontMatterUtil';

describe('splitFrontMatter', () => {
  it('returns null for plain text with no front matter', () => {
    expect(splitFrontMatter('just some text')).toBeNull();
  });

  it('returns null when --- delimiter is missing closing ---', () => {
    expect(splitFrontMatter('---\ntags:\n  - foo\n')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(splitFrontMatter('')).toBeNull();
  });

  it('parses yaml and body from valid front matter', () => {
    const text = '---\ntags:\n  - foo\n---\nHello world';
    const result = splitFrontMatter(text);
    expect(result).not.toBeNull();
    expect(result?.yamlStr).toBe('tags:\n  - foo');
    expect(result?.body).toBe('Hello world');
  });

  it('handles empty front matter block', () => {
    const text = '---\n\n---\nbody here';
    const result = splitFrontMatter(text);
    expect(result).not.toBeNull();
    expect(result?.yamlStr).toBe('');
    expect(result?.body).toBe('body here');
  });

  it('handles empty body after front matter', () => {
    const text = '---\ntitle: test\n---\n';
    const result = splitFrontMatter(text);
    expect(result).not.toBeNull();
    expect(result?.yamlStr).toBe('title: test');
    expect(result?.body).toBe('');
  });

  it('handles CRLF line endings, normalizing interior \\r out of yamlStr', () => {
    const text = '---\r\ntags:\r\n  - bar\r\n---\r\nbody';
    const result = splitFrontMatter(text);
    expect(result).not.toBeNull();
    expect(result?.yamlStr).toBe('tags:\n  - bar');
    expect(result?.body).toBe('body');
  });

  it('leaves CRLF in the body untouched', () => {
    const text = '---\r\ntitle: x\r\n---\r\nline one\r\nline two\r\n';
    const result = splitFrontMatter(text);
    expect(result?.yamlStr).toBe('title: x');
    expect(result?.body).toBe('line one\r\nline two\r\n');
  });

  it('does not match --- block not at the start of the string', () => {
    const text = 'intro\n---\ntags:\n  - foo\n---\nbody';
    expect(splitFrontMatter(text)).toBeNull();
  });

  it('body may contain --- sequences without confusion', () => {
    const text = '---\ntitle: doc\n---\nsome --- text\n---\nmore';
    const result = splitFrontMatter(text);
    expect(result).not.toBeNull();
    expect(result?.body).toBe('some --- text\n---\nmore');
  });

  it('allows trailing spaces on closing ---', () => {
    const text = '---\ntitle: x\n---   \nbody';
    const result = splitFrontMatter(text);
    expect(result).not.toBeNull();
    expect(result?.body).toBe('body');
  });

  it('allows trailing whitespace on the opening ---', () => {
    const text = '---  \ntitle: x\n---\nbody';
    const result = splitFrontMatter(text);
    expect(result).not.toBeNull();
    expect(result?.yamlStr).toBe('title: x');
    expect(result?.body).toBe('body');
  });

  it('matches a closing --- anchored at end of file with no trailing newline', () => {
    const text = '---\ntitle: x\n---';
    const result = splitFrontMatter(text);
    expect(result).not.toBeNull();
    expect(result?.yamlStr).toBe('title: x');
    expect(result?.body).toBe('');
  });

  it('does not treat closing ... (yaml end-doc) as a fence', () => {
    // Unlike parseFrontMatter, splitFrontMatter only recognizes --- fences.
    const text = '---\ntitle: x\n...\nbody';
    expect(splitFrontMatter(text)).toBeNull();
  });
});

describe('parseFrontMatter', () => {
  it('returns null yaml and unchanged content for plain text', () => {
    const result = parseFrontMatter('just some text');
    expect(result.yaml).toBeNull();
    expect(result.content).toBe('just some text');
  });

  it('parses yaml into an object and strips the block from the body', () => {
    const result = parseFrontMatter('---\ntitle: hello\ncount: 3\n---\nbody text');
    expect(result.yaml).toEqual({ title: 'hello', count: 3 });
    expect(result.content).toBe('body text');
  });

  it('preserves parsed value types (numbers, booleans, lists)', () => {
    const result = parseFrontMatter('---\nn: 42\nflag: true\ntags:\n  - a\n  - b\n---\nx');
    expect(result.yaml).toEqual({ n: 42, flag: true, tags: ['a', 'b'] });
  });

  it('does not accept a closing ... delimiter (only --- is supported)', () => {
    const raw = '---\ntitle: x\n...\nbody';
    const result = parseFrontMatter(raw);
    expect(result.yaml).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('requires the opening delimiter to be alone on its line', () => {
    const raw = '---something\ntitle: x\n---\nbody';
    const result = parseFrontMatter(raw);
    expect(result.yaml).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('requires the closing delimiter to be alone on its line', () => {
    const raw = '---\ntitle: x\n---something\nbody';
    const result = parseFrontMatter(raw);
    expect(result.yaml).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('agrees with splitFrontMatter about what counts as front matter', () => {
    for (const raw of [
      '---\ntitle: x\n---\nbody',
      '---\ntitle: x\n...\nbody',
      '---something\ntitle: x\n---\nbody',
      '---\ntitle: x\nno closing fence',
      'no front matter at all',
    ]) {
      expect(parseFrontMatter(raw).yaml !== null).toBe(splitFrontMatter(raw) !== null);
    }
  });

  it('handles a closing delimiter at end of file with no trailing newline', () => {
    const result = parseFrontMatter('---\ntitle: x\n---');
    expect(result.yaml).toEqual({ title: 'x' });
    expect(result.content).toBe('');
  });

  it('returns null yaml for an unterminated front matter block', () => {
    const raw = '---\ntitle: x\nno closing fence';
    const result = parseFrontMatter(raw);
    expect(result.yaml).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('returns null yaml (unchanged content) for malformed YAML', () => {
    const raw = '---\nthis: : : not valid\n---\nbody';
    const result = parseFrontMatter(raw);
    expect(result.yaml).toBeNull();
    // On malformed YAML the original content is returned untouched, not the body.
    expect(result.content).toBe(raw);
  });

  it('returns null yaml when the block parses to a non-object (array)', () => {
    const raw = '---\n- a\n- b\n---\nbody';
    const result = parseFrontMatter(raw);
    expect(result.yaml).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('returns null yaml when the block parses to a scalar', () => {
    const raw = '---\njust a string\n---\nbody';
    const result = parseFrontMatter(raw);
    expect(result.yaml).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('returns null yaml for an empty front matter block (parses to undefined)', () => {
    const raw = '---\n\n---\nbody';
    const result = parseFrontMatter(raw);
    expect(result.yaml).toBeNull();
    expect(result.content).toBe(raw);
  });

  it('preserves a blank line at the start of the body', () => {
    const result = parseFrontMatter('---\ntitle: x\n---\n\nbody');
    expect(result.yaml).toEqual({ title: 'x' });
    expect(result.content).toBe('\nbody');
  });
});

describe('assembleFrontMatter', () => {
  it('wraps yaml and body in --- fences', () => {
    expect(assembleFrontMatter('title: x', 'body')).toBe('---\ntitle: x\n---\nbody');
  });

  it('trims surrounding whitespace from the yaml content', () => {
    expect(assembleFrontMatter('\n  title: x  \n', 'body')).toBe('---\ntitle: x\n---\nbody');
  });

  it('returns just the body when yaml is empty', () => {
    expect(assembleFrontMatter('', 'body')).toBe('body');
  });

  it('returns just the body when yaml is only whitespace', () => {
    expect(assembleFrontMatter('   \n\t', 'body')).toBe('body');
  });

  it('round-trips with splitFrontMatter', () => {
    const original = '---\ntitle: x\ntags:\n  - a\n---\nthe body\nmore';
    const split = splitFrontMatter(original);
    expect(split).not.toBeNull();
    if (!split) return;
    expect(assembleFrontMatter(split.yamlStr, split.body)).toBe(original);
  });
});

describe('getPropsFromYaml', () => {
  it('returns all properties except tags', () => {
    expect(getPropsFromYaml('title: x\ntags:\n  - a\ncount: 2')).toEqual({ title: 'x', count: 2 });
  });

  it('preserves parsed value types', () => {
    expect(getPropsFromYaml('n: 5\nflag: false\nnested:\n  k: v')).toEqual({
      n: 5,
      flag: false,
      nested: { k: 'v' },
    });
  });

  it('returns an empty object for empty input', () => {
    expect(getPropsFromYaml('')).toEqual({});
  });

  it('returns an empty object for malformed YAML', () => {
    expect(getPropsFromYaml('this: : : not valid')).toEqual({});
  });

  it('returns an empty object when yaml has only a tags property', () => {
    expect(getPropsFromYaml('tags:\n  - a\n  - b')).toEqual({});
  });

  it('returns an empty object when yaml parses to null', () => {
    expect(getPropsFromYaml('null')).toEqual({});
  });
});

describe('setFrontMatterProperty', () => {
  it('replaces an existing property', () => {
    const result = setFrontMatterProperty('---\ndue: 5/1/2026\ntitle: hi\n---\nBody.', 'due', '12/25/2026');
    expect(result).toBe('---\ndue: 12/25/2026\ntitle: hi\n---\nBody.');
  });

  it('adds a new property to existing front matter', () => {
    const result = setFrontMatterProperty('---\ntitle: hi\n---\nBody.', 'duration', 2);
    expect(result).toBe('---\ntitle: hi\nduration: 2\n---\nBody.');
  });

  it('creates a front matter block when none exists', () => {
    const result = setFrontMatterProperty('Just body text.', 'due', '1/1/2027');
    expect(result).toBe('---\ndue: 1/1/2027\n---\nJust body text.');
  });

  it('canonicalizes the rest of the block (quotes dropped, comments removed)', () => {
    const result = setFrontMatterProperty('---\n# a comment\nstart: "9:30 AM"\n---\nBody.', 'due', '5/5/2026');
    expect(result).toBe('---\nstart: 9:30 AM\ndue: 5/5/2026\n---\nBody.');
  });

  it('returns content unchanged when the existing YAML cannot be parsed', () => {
    const content = '---\ndup: 1\ndup: 2\n---\nBody.';
    expect(setFrontMatterProperty(content, 'due', '1/1/2027')).toBe(content);
  });

  it('returns content unchanged when the YAML is not a mapping', () => {
    const content = '---\n- just\n- a list\n---\nBody.';
    expect(setFrontMatterProperty(content, 'due', '1/1/2027')).toBe(content);
  });

  it('does not fold long string values onto multiple lines', () => {
    const long = 'x'.repeat(120) + ' ' + 'y'.repeat(120);
    const result = setFrontMatterProperty('---\ntitle: hi\n---\nBody.', 'note', long);
    expect(result).toContain(`note: ${long}\n`);
  });
});
