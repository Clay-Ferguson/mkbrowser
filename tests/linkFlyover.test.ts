import { describe, it, expect } from 'vitest';
import { withLinkFlyover } from '../src/renderer/linkFlyover';

const ROOT = '/home/me/notes';

describe('withLinkFlyover', () => {
  it('appends the link line, relative to the root folder, to an existing flyover', () => {
    expect(withLinkFlyover('Created: x\nModified: y', '/home/me/notes/a/real.md', ROOT))
      .toBe('Created: x\nModified: y\nLink to: a/real.md');
  });

  it('is the whole flyover when the row has none', () => {
    expect(withLinkFlyover(undefined, '/home/me/notes/folder', ROOT)).toBe('Link to: folder');
  });

  it('ignores a trailing separator on the root', () => {
    expect(withLinkFlyover(undefined, '/home/me/notes/a/real.md', `${ROOT}/`)).toBe('Link to: a/real.md');
  });

  it('keeps the full path for a target outside the root, or the root itself', () => {
    expect(withLinkFlyover(undefined, '/home/me/other/x.md', ROOT)).toBe('Link to: /home/me/other/x.md');
    expect(withLinkFlyover(undefined, '/home/me/notes-archive/x.md', ROOT)).toBe('Link to: /home/me/notes-archive/x.md');
    expect(withLinkFlyover(undefined, ROOT, ROOT)).toBe(`Link to: ${ROOT}`);
  });

  it('keeps the full path when no root is known yet', () => {
    expect(withLinkFlyover(undefined, '/home/me/notes/a.md', '')).toBe('Link to: /home/me/notes/a.md');
  });

  it('leaves the flyover unchanged for anything that is not a link', () => {
    expect(withLinkFlyover('Created: x', undefined, ROOT)).toBe('Created: x');
    expect(withLinkFlyover(undefined, undefined, ROOT)).toBeUndefined();
  });
});
