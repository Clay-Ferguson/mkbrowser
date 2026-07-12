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
  isPathInside,
  isSamePath,
} from '../src/renderer/pathUtil';

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

  it('returns the root for a file directly under the unix root', () => {
    expect(getParentPath('/file.md')).toBe('/');
  });

  it('returns the drive root for a file directly under a windows drive', () => {
    expect(getParentPath('C:\\file.md')).toBe('C:\\');
  });

  it('returns empty string for an empty path', () => {
    expect(getParentPath('')).toBe('');
  });

  it('strips only the trailing separator for a path ending in one', () => {
    expect(getParentPath('/home/user/')).toBe('/home/user');
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

  it('returns empty string for a path ending in a backslash', () => {
    expect(getFileName('C:\\Users\\')).toBe('');
  });

  it('returns empty string for an empty path', () => {
    expect(getFileName('')).toBe('');
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

  it('collapses a leading backslash on the right part', () => {
    expect(joinPath('/home', '\\file.md')).toBe('/home/file.md');
  });

  it('returns the single part unchanged', () => {
    expect(joinPath('/home/user')).toBe('/home/user');
  });

  it('returns empty string when given no parts or only empty parts', () => {
    expect(joinPath()).toBe('');
    expect(joinPath('', '', '')).toBe('');
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

  it('splits a path with no separators into a single segment', () => {
    expect(splitPath('file.md')).toEqual(['file.md']);
  });

  it('splits an empty string into a single empty segment', () => {
    expect(splitPath('')).toEqual(['']);
  });

  it('splitPathSegments returns an empty array for an empty string', () => {
    expect(splitPathSegments('')).toEqual([]);
    expect(splitPathSegments('///')).toEqual([]);
  });
});

describe('endsWithSep / ensureTrailingSep', () => {
  it('detects both separators', () => {
    expect(endsWithSep('/a/')).toBe(true);
    expect(endsWithSep('C:\\a\\')).toBe(true);
    expect(endsWithSep('/a')).toBe(false);
  });

  it('reports false for an empty string', () => {
    expect(endsWithSep('')).toBe(false);
  });

  it('appends a separator only when missing', () => {
    expect(ensureTrailingSep('/a')).toBe('/a/');
    expect(ensureTrailingSep('/a/')).toBe('/a/');
    expect(ensureTrailingSep('C:\\a\\')).toBe('C:\\a\\');
  });

  it('appends the fallback separator to an empty string', () => {
    expect(ensureTrailingSep('')).toBe('/');
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

  it('rejects a drive letter without a following separator', () => {
    expect(isAbsolutePath('C:')).toBe(false);
    expect(isAbsolutePath('C:file.md')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isAbsolutePath('')).toBe(false);
  });

  it('treats a multi-character drive prefix as relative', () => {
    expect(isAbsolutePath('CD:\\Users')).toBe(false);
  });
});

describe('isSamePath', () => {
  it('matches identical paths', () => {
    expect(isSamePath('/home/user/notes', '/home/user/notes')).toBe(true);
  });

  it('ignores trailing separators', () => {
    expect(isSamePath('/home/user/notes/', '/home/user/notes')).toBe(true);
    expect(isSamePath('/home/user/notes', '/home/user/notes//')).toBe(true);
  });

  it('ignores separator spelling and repeated separators', () => {
    expect(isSamePath('/home/user/notes', '\\home\\user\\notes')).toBe(true);
    expect(isSamePath('/home//user/notes', '/home/user/notes')).toBe(true);
    expect(isSamePath('C:\\Users\\notes', 'C:/Users/notes')).toBe(true);
  });

  it('does NOT match different folders', () => {
    expect(isSamePath('/home/user/notes', '/home/user/notes-archive')).toBe(false);
    expect(isSamePath('/home/user/notes', '/home/user/notes/2024')).toBe(false);
    expect(isSamePath('/home/user/notes', 'home/user/notes')).toBe(false);
  });
});

describe('isPathInside', () => {
  it('treats a path as inside itself', () => {
    expect(isPathInside('/home/user/notes', '/home/user/notes')).toBe(true);
  });

  it('recognizes nested descendants', () => {
    expect(isPathInside('/home/user/notes', '/home/user/notes/2024')).toBe(true);
    expect(isPathInside('/home/user/notes', '/home/user/notes/a/b/c')).toBe(true);
  });

  it('does NOT treat a prefix-sharing sibling as inside', () => {
    expect(isPathInside('/home/user/notes', '/home/user/notes-archive/2024')).toBe(false);
    expect(isPathInside('/home/user/notes', '/home/user/notesxyz')).toBe(false);
  });

  it('ignores trailing separators on either argument', () => {
    expect(isPathInside('/home/user/notes/', '/home/user/notes')).toBe(true);
    expect(isPathInside('/home/user/notes', '/home/user/notes/')).toBe(true);
  });

  it('accepts windows-style separators', () => {
    expect(isPathInside('C:\\Users\\notes', 'C:\\Users\\notes\\2024')).toBe(true);
    expect(isPathInside('C:\\Users\\notes', 'C:\\Users\\notes-archive')).toBe(false);
  });

  it('rejects unrelated paths', () => {
    expect(isPathInside('/home/user/notes', '/var/log')).toBe(false);
  });

  it('matches across mixed separators between root and child', () => {
    expect(isPathInside('/home/user/notes', '/home/user/notes\\2024')).toBe(true);
    expect(isPathInside('C:\\Users\\notes', 'C:\\Users\\notes/2024')).toBe(true);
  });

  it('ignores multiple trailing separators', () => {
    expect(isPathInside('/home/user/notes//', '/home/user/notes')).toBe(true);
  });

  it('does not treat the child as inside when it is a parent of the root', () => {
    expect(isPathInside('/home/user/notes', '/home/user')).toBe(false);
  });
});
