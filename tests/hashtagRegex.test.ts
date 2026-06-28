import { describe, it, expect, beforeEach } from 'vitest';
import { HASHTAG_REGEX } from '../src/shared/regexPatterns';

beforeEach(() => {
  HASHTAG_REGEX.lastIndex = 0;
});

function matchAll(input: string): string[] {
  HASHTAG_REGEX.lastIndex = 0;
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = HASHTAG_REGEX.exec(input)) !== null) {
    results.push(m[0]);
  }
  return results;
}

describe('HASHTAG_REGEX', () => {
  describe('valid hashtags', () => {
    it('matches a simple hashtag at start of string', () => {
      expect(matchAll('#hello')).toEqual(['#hello']);
    });

    it('matches hashtag after whitespace', () => {
      expect(matchAll('some text #tag')).toEqual(['#tag']);
    });

    it('matches hashtag at start of line', () => {
      expect(matchAll('first line\n#tag')).toEqual(['#tag']);
    });

    it('matches hashtags with digits after the first letter', () => {
      expect(matchAll('#a1b')).toEqual(['#a1b']);
    });

    it('matches hashtags with underscores', () => {
      expect(matchAll('#my_tag')).toEqual(['#my_tag']);
    });

    it('matches hashtags with hyphens', () => {
      expect(matchAll('#my-tag')).toEqual(['#my-tag']);
    });

    it('matches multiple hashtags in one string', () => {
      expect(matchAll('#foo bar #baz')).toEqual(['#foo', '#baz']);
    });

    it('matches uppercase letters', () => {
      expect(matchAll('#MyTag')).toEqual(['#MyTag']);
    });
  });

  describe('invalid hashtags (should not match)', () => {
    it('does not match when # follows a non-whitespace character', () => {
      expect(matchAll('http://example.com/#section')).toEqual([]);
    });

    it('does not match when first char after # is a digit', () => {
      expect(matchAll('#1ab')).toEqual([]);
    });

    it('does not match a lone #', () => {
      expect(matchAll('#')).toEqual([]);
    });

    it('does not match # preceded by a slash', () => {
      expect(matchAll('/#mytag')).toEqual([]);
    });

    it('does not match # preceded by a letter', () => {
      expect(matchAll('word#tag')).toEqual([]);
    });
  });
});
