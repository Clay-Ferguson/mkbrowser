import { describe, it, expect } from 'vitest';
import {
  pathSep,
  getParentPath,
  getFileName,
  joinPath,
  splitPath,
  splitPathSegments,
  endsWithSep,
  ensureTrailingSep,
  isAbsolutePath,
} from '../src/utils/pathUtil';

// Outside the renderer there is no window.electronAPI, so pathSep() falls
// back to '/'. All joining assertions below assume that.

describe('pathSep', () => {
  it('falls back to "/" outside the renderer', () => {
    expect(pathSep()).toBe('/');
  });
});

describe('getParentPath', () => {
  it('returns the parent of a unix path', () => {
    expect(getParentPath('/home/user/file.md')).toBe('/home/user');
  });

  it('returns the parent of a windows path', () => {
    expect(getParentPath('C:\\Users\\clay\\file.md')).toBe('C:\\Users\\clay');
  });

  it('handles mixed separators by using the last of either', () => {
    expect(getParentPath('C:\\Users\\clay/file.md')).toBe('C:\\Users\\clay');
  });

  it('returns empty string for a bare file name', () => {
    expect(getParentPath('file.md')).toBe('');
  });

  it('returns empty string for a file directly under the root', () => {
    expect(getParentPath('/file.md')).toBe('');
  });
});

describe('getFileName', () => {
  it('returns the last segment of a unix path', () => {
    expect(getFileName('/home/user/file.md')).toBe('file.md');
  });

  it('returns the last segment of a windows path', () => {
    expect(getFileName('C:\\Users\\clay\\file.md')).toBe('file.md');
  });

  it('returns the whole string when there is no separator', () => {
    expect(getFileName('file.md')).toBe('file.md');
  });

  it('returns empty string for a path ending in a separator', () => {
    expect(getFileName('/home/user/')).toBe('');
  });
});

describe('joinPath', () => {
  it('joins simple parts', () => {
    expect(joinPath('/home/user', 'file.md')).toBe('/home/user/file.md');
  });

  it('collapses a trailing separator on the left part', () => {
    expect(joinPath('/home/user/', 'file.md')).toBe('/home/user/file.md');
  });

  it('collapses a leading separator on the right part', () => {
    expect(joinPath('/home/user', '/file.md')).toBe('/home/user/file.md');
  });

  it('skips empty parts', () => {
    expect(joinPath('', 'file.md')).toBe('file.md');
    expect(joinPath('/home', '', 'file.md')).toBe('/home/file.md');
  });

  it('joins more than two parts', () => {
    expect(joinPath('/a', 'b', 'c.md')).toBe('/a/b/c.md');
  });

  it('handles a windows-style trailing backslash on the left part', () => {
    expect(joinPath('C:\\Users\\', 'file.md')).toBe('C:\\Users/file.md');
  });
});

describe('splitPath / splitPathSegments', () => {
  it('splits on forward slashes', () => {
    expect(splitPath('/a/b/c')).toEqual(['', 'a', 'b', 'c']);
  });

  it('splits on backslashes', () => {
    expect(splitPath('C:\\a\\b')).toEqual(['C:', 'a', 'b']);
  });

  it('splitPathSegments drops empty segments', () => {
    expect(splitPathSegments('/a//b/')).toEqual(['a', 'b']);
    expect(splitPathSegments('C:\\a\\b')).toEqual(['C:', 'a', 'b']);
  });
});

describe('endsWithSep / ensureTrailingSep', () => {
  it('detects both separators', () => {
    expect(endsWithSep('/a/')).toBe(true);
    expect(endsWithSep('C:\\a\\')).toBe(true);
    expect(endsWithSep('/a')).toBe(false);
  });

  it('appends a separator only when missing', () => {
    expect(ensureTrailingSep('/a')).toBe('/a/');
    expect(ensureTrailingSep('/a/')).toBe('/a/');
    expect(ensureTrailingSep('C:\\a\\')).toBe('C:\\a\\');
  });
});

describe('isAbsolutePath', () => {
  it('recognizes unix absolute paths', () => {
    expect(isAbsolutePath('/home/user')).toBe(true);
  });

  it('recognizes windows drive paths with either separator', () => {
    expect(isAbsolutePath('C:\\Users')).toBe(true);
    expect(isAbsolutePath('c:/Users')).toBe(true);
  });

  it('recognizes UNC-style paths', () => {
    expect(isAbsolutePath('\\\\server\\share')).toBe(true);
  });

  it('rejects relative paths', () => {
    expect(isAbsolutePath('file.md')).toBe(false);
    expect(isAbsolutePath('./file.md')).toBe(false);
    expect(isAbsolutePath('../file.md')).toBe(false);
  });
});
