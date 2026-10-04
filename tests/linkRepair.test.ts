import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/renderer/api', () => ({
  api: {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    findMarkdownById: vi.fn(),
  },
  // pathUtil reads the separator through getApi(); undefined selects its '/' fallback.
  getApi: () => undefined,
}));

import { api } from '../src/renderer/api';
import { useAS } from '../src/store';
import { openIdLink, replaceIdLinkDestinations } from '../src/renderer/linkRepair';

const SRC = '/notes/thread/index.md';
const BROKEN = '/notes/Job Interview Thread/HUMAN.md';

describe('replaceIdLinkDestinations', () => {
  it('rewrites an angle-bracket destination relative to the source file', () => {
    const content = 'See [HUMAN](<../Job Interview Thread/HUMAN.md> "id:3D6B20DDF") here.';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, '3D6B20DDF', '/notes/Job Interview Thread/PERSON.md'))
      .toBe('See [HUMAN](<../Job Interview Thread/PERSON.md> "id:3D6B20DDF") here.');
  });

  it('switches to a bare destination when the new path needs no brackets', () => {
    const content = '[HUMAN](<../Job Interview Thread/HUMAN.md> "id:ABC")';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/notes/thread/sub/human.md'))
      .toBe('[HUMAN](sub/human.md "id:ABC")');
  });

  it('rewrites a bare, percent-encoded destination', () => {
    const content = '[HUMAN](../Job%20Interview%20Thread/HUMAN.md "id:ABC")';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/other/HUMAN.md'))
      .toBe('[HUMAN](../../other/HUMAN.md "id:ABC")');
  });

  it('leaves a link with a different id alone', () => {
    const content = '[HUMAN](<../Job Interview Thread/HUMAN.md> "id:XYZ")';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/other/HUMAN.md')).toBe(content);
  });

  it('leaves a link with the same id but another destination alone', () => {
    const content = '[HUMAN](elsewhere.md "id:ABC")';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/other/HUMAN.md')).toBe(content);
  });

  it('leaves links without an id title alone', () => {
    const content = '[HUMAN](<../Job Interview Thread/HUMAN.md> "Some title")';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/other/HUMAN.md')).toBe(content);
  });

  it('fixes every matching occurrence and keeps labels', () => {
    const content = [
      'a [one](<../Job Interview Thread/HUMAN.md> "id:ABC")',
      'b [two](../Job%20Interview%20Thread/HUMAN.md "id:ABC")',
    ].join('\n');
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/notes/thread/HUMAN.md')).toBe([
      'a [one](HUMAN.md "id:ABC")',
      'b [two](HUMAN.md "id:ABC")',
    ].join('\n'));
  });

  it('formats a new path containing spaces in angle brackets', () => {
    const content = '[x](old.md "id:ABC")';
    expect(replaceIdLinkDestinations(content, SRC, '/notes/thread/old.md', 'ABC', '/notes/thread/new name.md'))
      .toBe('[x](<new name.md> "id:ABC")');
  });

  it('treats a $ in the new path literally', () => {
    const content = '[x](old.md "id:ABC")';
    expect(replaceIdLinkDestinations(content, SRC, '/notes/thread/old.md', 'ABC', '/notes/thread/$&cost.md'))
      .toBe('[x]($&cost.md "id:ABC")');
  });

  it('keeps a heading fragment on a repaired link', () => {
    const content = '[HUMAN](<../Job Interview Thread/HUMAN.md#next-steps> "id:ABC")';
    expect(replaceIdLinkDestinations(content, SRC, BROKEN, 'ABC', '/notes/thread/sub/human.md'))
      .toBe('[HUMAN](sub/human.md#next-steps "id:ABC")');
    expect(replaceIdLinkDestinations('[x](old.md#a-b "id:ABC")', SRC, '/notes/thread/old.md', 'ABC', '/notes/thread/new name.md'))
      .toBe('[x](<new name.md#a-b> "id:ABC")');
  });

  it('matches an id title containing escaped quotes', () => {
    const content = '[x](old.md "id:A\\"B")';
    expect(replaceIdLinkDestinations(content, SRC, '/notes/thread/old.md', 'A"B', '/notes/thread/new.md'))
      .toBe('[x](new.md "id:A\\"B")');
  });
});

describe('openIdLink when the link target exists', () => {
  const TARGET = '/notes/a/HUMAN.md';

  beforeEach(() => {
    vi.resetAllMocks();
    useAS.setState({ rootPath: '/notes', linkIdMismatch: null, highlightItem: null });
    vi.mocked(api.pathExists).mockResolvedValue(true);
  });

  /** Lets the fire-and-forget promise chain inside openIdLink run to completion. */
  const settle = () => new Promise((r) => { setTimeout(r, 0); });

  it('opens the file without a warning when its front-matter id matches', async () => {
    vi.mocked(api.readFile).mockResolvedValue({ ok: true, content: '---\nid: ABC\n---\nBody' });
    openIdLink('/notes/index.md', TARGET, 'ABC');
    await settle();
    expect(useAS.getState().highlightItem).toBe(TARGET);
    expect(useAS.getState().linkIdMismatch).toBeNull();
    expect(api.findMarkdownById).not.toHaveBeenCalled();
    expect(api.writeFile).not.toHaveBeenCalled();
  });

  it('warns and names the file carrying the id when the ids differ', async () => {
    vi.mocked(api.readFile).mockResolvedValue({ ok: true, content: '---\nid: XYZ\n---\nBody' });
    vi.mocked(api.findMarkdownById).mockResolvedValue('/notes/b/RENAMED.md');
    openIdLink('/notes/index.md', TARGET, 'ABC');
    await settle();
    expect(useAS.getState().highlightItem).toBe(TARGET);
    expect(api.findMarkdownById).toHaveBeenCalledWith('ABC', '/notes/a', '/notes');
    expect(useAS.getState().linkIdMismatch).toEqual({
      linkId: 'ABC', openedPath: TARGET, openedId: 'XYZ', otherPath: '/notes/b/RENAMED.md',
    });
    expect(api.writeFile).not.toHaveBeenCalled(); // never repairs on a mismatch
  });

  it('warns when the opened file has no id and no other file has it', async () => {
    vi.mocked(api.readFile).mockResolvedValue({ ok: true, content: 'No front matter' });
    vi.mocked(api.findMarkdownById).mockResolvedValue(null);
    openIdLink('/notes/index.md', TARGET, 'ABC');
    await settle();
    expect(useAS.getState().linkIdMismatch).toEqual({
      linkId: 'ABC', openedPath: TARGET, openedId: null, otherPath: null,
    });
  });

  it('opens the file in single-file mode and queues the heading scroll', async () => {
    useAS.setState({ pendingScrollToHeadingSlug: null, browseFileName: null });
    vi.mocked(api.readFile).mockResolvedValue({ ok: true, content: '---\nid: ABC\n---\nBody' });
    openIdLink('/notes/index.md', TARGET, 'ABC', 'requirements');
    await settle();
    expect(useAS.getState().browseFileName).toBe('HUMAN.md');
    expect(useAS.getState().currentPath).toBe('/notes/a');
    expect(useAS.getState().pendingScrollToHeadingSlug).toBe('requirements');
  });

  it('does not warn when the opened file cannot be read', async () => {
    vi.mocked(api.readFile).mockResolvedValue({ ok: false, error: 'EACCES' });
    openIdLink('/notes/index.md', TARGET, 'ABC');
    await settle();
    expect(useAS.getState().linkIdMismatch).toBeNull();
  });
});
