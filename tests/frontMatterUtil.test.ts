import { describe, it, expect } from 'vitest';
import { splitFrontMatter } from '../src/utils/frontMatterUtil';

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

  it('handles CRLF line endings', () => {
    const text = '---\r\ntags:\r\n  - bar\r\n---\r\nbody';
    const result = splitFrontMatter(text);
    expect(result).not.toBeNull();
    expect(result?.yamlStr).toBe('tags:\r\n  - bar');
    expect(result?.body).toBe('body');
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
});
