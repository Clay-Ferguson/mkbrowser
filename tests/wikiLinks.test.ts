import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/renderer/api', () => ({
  api: {
    pathExists: vi.fn(),
    isDirectory: vi.fn(),
    createFile: vi.fn(),
    readDirectory: vi.fn(),
  },
  // pathUtil reads the separator through getApi(); undefined selects its '/' fallback.
  getApi: () => undefined,
}));

import { api } from '../src/renderer/api';
import { useAS } from '../src/store';
import { isCreatableWikiLinkTarget, openWikiLink, withWikiLinkExtension } from '../src/renderer/wikiLinks';

const SRC = '/notes/index.md';

describe('isCreatableWikiLinkTarget', () => {
  it('accepts a plain file name, with or without an extension or spaces', () => {
    expect(isCreatableWikiLinkTarget('note')).toBe(true);
    expect(isCreatableWikiLinkTarget('My Note.md')).toBe(true);
    expect(isCreatableWikiLinkTarget('2026-10-20 plan')).toBe(true);
  });

  it('rejects names starting with a dot or a separator', () => {
    expect(isCreatableWikiLinkTarget('.hidden')).toBe(false);
    expect(isCreatableWikiLinkTarget('../up')).toBe(false);
    expect(isCreatableWikiLinkTarget('./here')).toBe(false);
    expect(isCreatableWikiLinkTarget('/abs/note')).toBe(false);
    expect(isCreatableWikiLinkTarget('\\abs\\note')).toBe(false);
    expect(isCreatableWikiLinkTarget('')).toBe(false);
  });

  it('rejects names that reach into another folder', () => {
    expect(isCreatableWikiLinkTarget('sub/note')).toBe(false);
    expect(isCreatableWikiLinkTarget('sub\\note')).toBe(false);
    expect(isCreatableWikiLinkTarget('C:note')).toBe(false);
  });

  it('rejects wikilink-reserved and control characters', () => {
    expect(isCreatableWikiLinkTarget('note#intro')).toBe(false);
    expect(isCreatableWikiLinkTarget('a^b')).toBe(false);
    expect(isCreatableWikiLinkTarget('a\tb')).toBe(false);
  });
});

describe('withWikiLinkExtension', () => {
  it('appends .md unless the name is already a Markdown or text file', () => {
    expect(withWikiLinkExtension('note')).toBe('note.md');
    expect(withWikiLinkExtension('v1.2 plan')).toBe('v1.2 plan.md');
    expect(withWikiLinkExtension('note.md')).toBe('note.md');
    expect(withWikiLinkExtension('todo.txt')).toBe('todo.txt');
  });
});

describe('openWikiLink', () => {
  const existing = new Set<string>();

  beforeEach(() => {
    vi.clearAllMocks();
    existing.clear();
    vi.mocked(api.pathExists).mockImplementation(async (p: string) => existing.has(p));
    vi.mocked(api.isDirectory).mockResolvedValue(false);
    vi.mocked(api.createFile).mockResolvedValue({ success: true });
    vi.mocked(api.readDirectory).mockResolvedValue([]);
    useAS.setState({
      currentPath: '/notes',
      browseFileName: null,
      pendingEditFile: null,
      pendingEditView: null,
      indexTreeRoot: null,
    });
  });

  // openWikiLink is fire-and-forget; let its promise chain settle.
  const settle = () => new Promise((r) => { setTimeout(r, 0); });

  it('opens an existing target without creating anything', async () => {
    existing.add('/notes/todo.txt');
    openWikiLink(SRC, 'todo.txt');
    await settle();
    expect(api.createFile).not.toHaveBeenCalled();
    expect(useAS.getState().browseFileName).toBe('todo.txt');
    expect(useAS.getState().pendingEditFile).toBeNull();
  });

  it('finds the .md file of an extension-less target', async () => {
    existing.add('/notes/note.md');
    openWikiLink(SRC, 'note');
    await settle();
    expect(api.createFile).not.toHaveBeenCalled();
    expect(useAS.getState().browseFileName).toBe('note.md');
  });

  it('scrolls to the heading of an existing target', async () => {
    existing.add('/notes/guide.md');
    useAS.setState({ pendingScrollToHeadingSlug: null });
    openWikiLink(SRC, 'guide.md', 'getting-started');
    await settle();
    expect(useAS.getState().browseFileName).toBe('guide.md');
    expect(useAS.getState().pendingScrollToHeadingSlug).toBe('getting-started');
  });

  it('creates a missing target next to the linking file and opens it for editing', async () => {
    openWikiLink(SRC, 'My Note');
    await settle();
    expect(api.createFile).toHaveBeenCalledWith('/notes/My Note.md', '');
    const state = useAS.getState();
    expect(state.currentPath).toBe('/notes');
    expect(state.browseFileName).toBe('My Note.md');
    expect(state.pendingEditFile).toBe('/notes/My Note.md');
    expect(state.pendingEditView).toBe('browser');
  });

  it('never creates a target outside the linking file\'s folder', async () => {
    for (const target of ['../up', 'sub/note', '.hidden', '/abs/note']) {
      openWikiLink(SRC, target);
    }
    await settle();
    expect(api.createFile).not.toHaveBeenCalled();
    expect(useAS.getState().pendingEditFile).toBeNull();
  });

  it('reports a failed create and does not open the file', async () => {
    vi.mocked(api.createFile).mockResolvedValue({ success: false, error: 'Permission denied' });
    useAS.setState({ appError: null });
    openWikiLink(SRC, 'note');
    await settle();
    expect(useAS.getState().appError).toBe('Failed to create file: Permission denied');
    expect(useAS.getState().browseFileName).toBeNull();
  });
});
