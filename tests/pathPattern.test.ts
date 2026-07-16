import { describe, it, expect } from 'vitest';
import { buildCalendarFilter } from '../src/shared/pathPattern';

// buildCalendarFilter is the single predicate shared by the calendar's initial
// crawl (fdir) and its live watcher (chokidar). These tests pin the behaviour the
// two must agree on — the M3 divergence bugs.
describe('buildCalendarFilter', () => {
  const exclude = buildCalendarFilter([]);

  it('keeps a directory with a dotted (non-.md) name so it stays traversable', () => {
    // The core M3 bug: `notes.2024` has extension `.2024`; pruning it as a "file"
    // hid every .md beneath it from the watcher.
    expect(exclude('notes.2024', '/vault/notes.2024', true)).toBe(false);
    expect(exclude('v1.2', '/vault/v1.2', true)).toBe(false);
  });

  it('excludes a non-.md file', () => {
    expect(exclude('README', '/vault/README', false)).toBe(true);
    expect(exclude('notes.txt', '/vault/notes.txt', false)).toBe(true);
  });

  it('keeps a .md file (any case)', () => {
    expect(exclude('event.md', '/vault/event.md', false)).toBe(false);
    expect(exclude('EVENT.MD', '/vault/EVENT.MD', false)).toBe(false);
  });

  it('keeps an entry of unknown type (pre-stat), skipping the .md rule', () => {
    // A non-.md name is still kept when the type is unknown, so a directory is
    // never pruned before chokidar can identify it.
    expect(exclude('notes.2024', '/vault/notes.2024', undefined)).toBe(false);
    expect(exclude('README', '/vault/README', undefined)).toBe(false);
  });

  it('always excludes hidden entries regardless of type', () => {
    expect(exclude('.git', '/vault/.git', true)).toBe(true);
    expect(exclude('.hidden.md', '/vault/.hidden.md', false)).toBe(true);
    expect(exclude('.DS_Store', '/vault/.DS_Store', undefined)).toBe(true);
  });

  it('excludes entries matching a user ignore pattern (anchored, basename or path)', () => {
    const withPattern = buildCalendarFilter(['archive', '*.tmp']);
    expect(withPattern('archive', '/vault/archive', true)).toBe(true);
    expect(withPattern('scratch.tmp', '/vault/scratch.tmp', false)).toBe(true);
    // Anchored: a name merely containing the pattern is not excluded.
    expect(withPattern('archived.md', '/vault/archived.md', false)).toBe(false);
  });

  it('does not special-case node_modules (matches the loader — exclude via patterns)', () => {
    expect(exclude('node_modules', '/vault/node_modules', true)).toBe(false);
    const ignored = buildCalendarFilter(['node_modules']);
    expect(ignored('node_modules', '/vault/node_modules', true)).toBe(true);
  });
});
