/**
 * Unit tests for the pure drop-validation predicates in src/renderer/dragAndDrop.ts.
 * These decide whether a drag may be dropped at all; the move itself (completeEntryDrop /
 * dropAsAttachment) needs the IPC bridge and is exercised manually / in the packaged app.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  canDropInto,
  canDropAsAttachment,
  affectsBrowseListing,
  parseDragPayload,
  type DragPayload,
} from '../src/renderer/dragAndDrop';
import { makeTreeNodes, makeFileChildren, mergeTreeNodes, refreshExpandedNodes } from '../src/renderer/treeNodes';
import { useAS } from '../src/store/core';
import { collapseAllIndexTreeNodes } from '../src/store/indexTree';
import { setItemContent } from '../src/store/items';
import { extractHeadingTree } from '../src/shared/tocUtil';
import { api } from '../src/renderer/api';
import type { FileNode, MarkdownHeadingNode, TreeNode } from '../src/shared/types';

vi.mock('../src/renderer/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/api')>()),
  api: { readDirectory: vi.fn() },
}));

function file(path: string): DragPayload {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { path, name, isDirectory: false };
}

function folder(path: string): DragPayload {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { path, name, isDirectory: true };
}

// ---------------------------------------------------------------------------
// canDropInto — dropping onto a folder
// ---------------------------------------------------------------------------

describe('canDropInto', () => {
  it('accepts a file dropped into a different folder', () => {
    expect(canDropInto(file('/root/a/notes.md'), '/root/b')).toBe(true);
  });

  it('rejects a drop into the folder the item already lives in', () => {
    expect(canDropInto(file('/root/a/notes.md'), '/root/a')).toBe(false);
  });

  it('rejects a folder dropped onto itself', () => {
    expect(canDropInto(folder('/root/a'), '/root/a')).toBe(false);
  });

  it('rejects a folder dropped into its own descendant', () => {
    expect(canDropInto(folder('/root/a'), '/root/a/sub/deeper')).toBe(false);
  });

  it('does not treat a sibling with a shared name prefix as a descendant', () => {
    // The boundary-correct check exists so '/root/projects-archive' is not seen
    // as living inside '/root/projects'.
    expect(canDropInto(folder('/root/projects'), '/root/projects-archive')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canDropAsAttachment — dropping onto a file
// ---------------------------------------------------------------------------

describe('canDropAsAttachment', () => {
  it('accepts a file dropped onto a different file in the same folder', () => {
    expect(canDropAsAttachment(file('/root/a/diagram.png'), '/root/a/notes.md')).toBe(true);
  });

  it('accepts a folder dropped onto a file', () => {
    expect(canDropAsAttachment(folder('/root/a/assets'), '/root/a/notes.md')).toBe(true);
  });

  it('rejects a file dropped onto itself', () => {
    // Without this the file would be moved into an .attach folder named after itself.
    expect(canDropAsAttachment(file('/root/a/notes.md'), '/root/a/notes.md')).toBe(false);
  });

  it("rejects a file's own attach folder dropped back onto it", () => {
    expect(canDropAsAttachment(folder('/root/a/notes.md.attach'), '/root/a/notes.md')).toBe(false);
  });

  it('rejects an item that is already attached to that file', () => {
    expect(canDropAsAttachment(file('/root/a/notes.md.attach/diagram.png'), '/root/a/notes.md')).toBe(false);
  });

  it('rejects a folder dropped onto a file it contains', () => {
    expect(canDropAsAttachment(folder('/root/a'), '/root/a/sub/notes.md')).toBe(false);
  });

  it('accepts re-attaching an item from one file to another', () => {
    expect(canDropAsAttachment(file('/root/a/one.md.attach/diagram.png'), '/root/a/two.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// affectsBrowseListing — decides whether a drop refreshes the browse view
// ---------------------------------------------------------------------------

describe('affectsBrowseListing', () => {
  const cur = '/root/docs';

  it('is true for the browsed folder itself', () => {
    expect(affectsBrowseListing(cur, cur)).toBe(true);
  });

  it('ignores trailing-separator and separator-spelling differences', () => {
    expect(affectsBrowseListing('/root/docs/', cur)).toBe(true);
  });

  it('is true for an attachment folder in the browsed folder', () => {
    // The regression this guards: a file moved *out of* an attach folder left a
    // stale row behind, because the source folder is not currentPath and so no
    // refresh was triggered. readDirectory pre-loads attachments into the listing,
    // so that folder's contents are on screen and the view must reload.
    expect(affectsBrowseListing('/root/docs/notes.md.attach', cur)).toBe(true);
  });

  it('is true for a nested attachment folder', () => {
    expect(affectsBrowseListing('/root/docs/notes.md.attach/chart.png.attach', cur)).toBe(true);
  });

  it('is false for an ordinary subfolder, whose contents are not rendered', () => {
    expect(affectsBrowseListing('/root/docs/subfolder', cur)).toBe(false);
  });

  it('is false for an attachment folder inside an ordinary subfolder', () => {
    expect(affectsBrowseListing('/root/docs/subfolder/notes.md.attach', cur)).toBe(false);
  });

  it('is false for the parent folder and for unrelated folders', () => {
    expect(affectsBrowseListing('/root', cur)).toBe(false);
    expect(affectsBrowseListing('/root/other', cur)).toBe(false);
  });

  it('does not treat a name-prefix sibling as being inside the browsed folder', () => {
    expect(affectsBrowseListing('/root/docs-archive/notes.md.attach', cur)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseDragPayload
// ---------------------------------------------------------------------------

describe('parseDragPayload', () => {
  it('round-trips a serialized payload', () => {
    const payload = folder('/root/a/assets');
    expect(parseDragPayload(JSON.stringify(payload))).toEqual(payload);
  });

  it('defaults isDirectory to false when absent', () => {
    expect(parseDragPayload('{"path":"/root/a/x.md","name":"x.md"}')).toEqual({
      path: '/root/a/x.md',
      name: 'x.md',
      isDirectory: false,
    });
  });

  it('returns null for an empty string, malformed JSON, or a payload missing fields', () => {
    expect(parseDragPayload('')).toBeNull();
    expect(parseDragPayload('{not json')).toBeNull();
    expect(parseDragPayload('{"path":"/root/a/x.md"}')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergeTreeNodes — refreshing a folder's children without collapsing the tree
// ---------------------------------------------------------------------------

function entry(path: string, isDirectory: boolean, indexOrder?: number, hasAttachFolder?: boolean) {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    isDirectory,
    ...(indexOrder !== undefined ? { indexOrder } : {}),
    ...(hasAttachFolder ? { hasAttachFolder } : {}),
  };
}

function node(path: string, isDirectory: boolean, isExpanded: boolean, children: TreeNode[] | null): FileNode {
  return {
    path,
    name: path.slice(path.lastIndexOf('/') + 1),
    isDirectory,
    isExpanded,
    isLoading: false,
    children,
  };
}

describe('mergeTreeNodes', () => {
  it('keeps the expansion state and loaded children of surviving folders', () => {
    const grandchild = node('/root/a/deep', true, true, []);
    const previous = [node('/root/a', true, true, [grandchild])];

    const merged = mergeTreeNodes([entry('/root/a', true), entry('/root/new.md', false)], previous);

    expect(merged).toHaveLength(2);
    expect(merged[0]!.isExpanded).toBe(true);
    expect(merged[0]!.children).toEqual([grandchild]);
    // The item that just appeared on disk comes in collapsed and unloaded.
    expect(merged[1]!.isExpanded).toBe(false);
    expect(merged[1]!.children).toBeNull();
  });

  it('drops nodes that are no longer on disk (e.g. the source of a move)', () => {
    const previous = [node('/root/a', true, true, []), node('/root/moved.md', false, false, null)];

    const merged = mergeTreeNodes([entry('/root/a', true)], previous);

    expect(merged.map(n => n.path)).toEqual(['/root/a']);
  });

  it('takes indexOrder from the fresh listing, not the stale node', () => {
    const stale: FileNode = { ...node('/root/a.md', false, false, null), indexOrder: 5 };

    const [reordered] = mergeTreeNodes([entry('/root/a.md', false, 0)], [stale]);
    expect(reordered!.indexOrder).toBe(0);

    // An entry that left the index loses its ordinal rather than keeping the old one.
    const [unindexed] = mergeTreeNodes([entry('/root/a.md', false)], [stale]);
    expect(unindexed).not.toHaveProperty('indexOrder');
  });

  it('does not let a path that changed kind inherit the old children', () => {
    const previous = [node('/root/x', true, true, [node('/root/x/child.md', false, false, null)])];

    const [replaced] = mergeTreeNodes([entry('/root/x', false)], previous);

    expect(replaced!.isExpanded).toBe(false);
    expect(replaced!.children).toBeNull();
  });

  it('returns freshly collapsed nodes when there is nothing to merge with', () => {
    expect(mergeTreeNodes([entry('/root/a', true)], null)).toEqual([
      node('/root/a', true, false, null),
    ]);
  });
});

describe('refreshExpandedNodes — structural sharing', () => {
  // /root (expanded) -> a/ (expanded) -> deep.md, plus b/ (expanded, empty)
  function tree(): FileNode {
    return node('/root', true, true, [
      node('/root/a', true, true, [node('/root/a/deep.md', false, false, null)]),
      node('/root/b', true, true, []),
    ]);
  }
  const listings: Record<string, ReturnType<typeof entry>[]> = {
    '/root': [entry('/root/a', true), entry('/root/b', true)],
    '/root/a': [entry('/root/a/deep.md', false)],
    '/root/b': [],
  };
  vi.mocked(api.readDirectory).mockImplementation(async (p: string) => (listings[p] ?? []) as never);

  it('returns the same root when nothing changed on disk', async () => {
    const root = tree();
    expect(await refreshExpandedNodes(root)).toBe(root);
  });

  it('rebuilds only the path to a changed folder, sharing untouched siblings', async () => {
    const root = tree();
    listings['/root/a'] = [entry('/root/a/deep.md', false), entry('/root/a/new.md', false)];
    try {
      const refreshed = await refreshExpandedNodes(root);
      expect(refreshed).not.toBe(root);
      const [a, b] = refreshed.children as FileNode[];
      expect(a).not.toBe(root.children![0]);
      expect(a!.children![0]).toBe((root.children![0] as FileNode).children![0]);
      expect(b).toBe(root.children![1]);
    } finally {
      listings['/root/a'] = [entry('/root/a/deep.md', false)];
    }
  });
});

// ---------------------------------------------------------------------------
// Attachment folders — shown as the first child of their owning file
// ---------------------------------------------------------------------------

function heading(path: string): MarkdownHeadingNode {
  return { path, heading: 'H', slug: 'h', depth: 1, isExpanded: false, isLoading: false, children: null };
}

/** A file node that owns an attach folder. */
function owner(path: string, isExpanded: boolean, children: TreeNode[] | null): FileNode {
  return { ...node(path, false, isExpanded, children), hasAttachFolder: true };
}

describe('makeTreeNodes / makeFileChildren — attachment folders', () => {
  it('flags owning files and keeps .attach folders out of the folder listing', () => {
    const nodes = makeTreeNodes([
      entry('/root/a.md', false, undefined, true),
      entry('/root/a.md.attach', true),
      entry('/root/b.md', false),
    ]);
    expect(nodes.map(n => n.path)).toEqual(['/root/a.md', '/root/b.md']);
    expect(nodes[0]!.hasAttachFolder).toBe(true);
    expect(nodes[1]).not.toHaveProperty('hasAttachFolder');
  });

  it('puts the attach folder first, before headings, keeping its real name', () => {
    const h = heading('/root/a.md#0');
    const [attach, ...rest] = makeFileChildren(owner('/root/a.md', false, null), [h]) as FileNode[];
    expect(attach).toEqual(node('/root/a.md.attach', true, false, null));
    expect(rest).toEqual([h]);
  });

  it('adds nothing for a file without an attach folder', () => {
    const h = heading('/root/b.md#0');
    expect(makeFileChildren(node('/root/b.md', false, false, null), [h])).toEqual([h]);
  });
});

describe('mergeTreeNodes — attachment folder appearing / disappearing', () => {
  it('prepends the attach node to an expanded file when its folder appears, keeping headings', () => {
    const h = heading('/root/a.md#0');
    const [merged] = mergeTreeNodes([entry('/root/a.md', false, undefined, true)], [node('/root/a.md', false, true, [h])]);
    expect(merged!.isExpanded).toBe(true);
    expect(merged!.children!.map(c => c.path)).toEqual(['/root/a.md.attach', '/root/a.md#0']);
  });

  it('removes the attach node when its folder is gone', () => {
    const h = heading('/root/a.md#0');
    const previous = [owner('/root/a.md', true, [node('/root/a.md.attach', true, true, []), h])];
    const [merged] = mergeTreeNodes([entry('/root/a.md', false)], previous);
    expect(merged!.hasAttachFolder).toBeUndefined();
    expect(merged!.children).toEqual([h]);
  });

  it('reuses the node (and its expanded attach child) when nothing changed', () => {
    const previous = [owner('/root/a.md', true, [node('/root/a.md.attach', true, true, [])])];
    const merged = mergeTreeNodes([entry('/root/a.md', false, undefined, true)], previous);
    expect(merged).toBe(previous);
  });

  it('leaves a never-expanded file unloaded', () => {
    const [merged] = mergeTreeNodes([entry('/root/a.md', false, undefined, true)], [node('/root/a.md', false, false, null)]);
    expect(merged!.hasAttachFolder).toBe(true);
    expect(merged!.children).toBeNull();
  });
});

describe('refreshExpandedNodes — attach folder under an expanded file', () => {
  const listings: Record<string, ReturnType<typeof entry>[]> = {
    '/r': [entry('/r/a.md', false, undefined, true), entry('/r/a.md.attach', true)],
    '/r/a.md.attach': [entry('/r/a.md.attach/img.png', false)],
  };
  function tree(): FileNode {
    return node('/r', true, true, [
      owner('/r/a.md', true, [node('/r/a.md.attach', true, true, [node('/r/a.md.attach/img.png', false, false, null)])]),
    ]);
  }

  it('returns the same root when nothing changed', async () => {
    vi.mocked(api.readDirectory).mockImplementation(async (p: string) => (listings[p] ?? []) as never);
    const root = tree();
    expect(await refreshExpandedNodes(root)).toBe(root);
  });

  it('re-reads the expanded attach folder', async () => {
    vi.mocked(api.readDirectory).mockImplementation(async (p: string) => (
      p === '/r/a.md.attach' ? [...listings[p]!, entry('/r/a.md.attach/new.pdf', false)] : listings[p] ?? []
    ) as never);
    const refreshed = await refreshExpandedNodes(tree());
    const attach = (refreshed.children![0] as FileNode).children![0] as FileNode;
    expect(attach.children!.map(c => c.path)).toEqual(['/r/a.md.attach/img.png', '/r/a.md.attach/new.pdf']);
  });
});

describe('collapseAllIndexTreeNodes', () => {
  it('collapses expanded files and the attach folders under them', () => {
    const h = heading('/r/a.md#0');
    useAS.setState({
      indexTreeRoot: node('/r', true, true, [
        owner('/r/a.md', true, [node('/r/a.md.attach', true, true, []), h]),
      ]),
    });
    collapseAllIndexTreeNodes();
    const root = useAS.getState().indexTreeRoot!;
    expect(root.isExpanded).toBe(true);
    const file = root.children![0] as FileNode;
    expect(file.isExpanded).toBe(false);
    expect((file.children![0] as FileNode).isExpanded).toBe(false);
    expect(file.children![1]).toBe(h);
  });
});

describe('setItemContent — keeps an expanded file\'s headings in the tree current', () => {
  const FILE = '/r/a.md';
  const NESTED = '/r/a.md.attach/b.md';

  /** /r -> a.md (expanded: attach folder + headings of `content`) -> a.md.attach (expanded) -> b.md */
  function seed(content: string, nestedChildren: TreeNode[] | null = null): void {
    useAS.setState({
      items: new Map(),
      indexTreeRoot: node('/r', true, true, [
        owner(FILE, true, [
          node('/r/a.md.attach', true, true, [node(NESTED, false, nestedChildren !== null, nestedChildren)]),
          ...extractHeadingTree(FILE, content),
        ]),
      ]),
    });
  }
  const fileNode = () => useAS.getState().indexTreeRoot!.children![0] as FileNode;
  const headingTexts = (children: TreeNode[]) => children.filter(c => 'heading' in c).map(c => (c as MarkdownHeadingNode).heading);

  it('rebuilds the headings from the saved content, keeping the attach folder child', () => {
    seed('# One\n');
    const attach = fileNode().children![0];
    setItemContent(FILE, '# One\n# Two\n', 1);
    expect(fileNode().children![0]).toBe(attach);
    expect(headingTexts(fileNode().children!)).toEqual(['One', 'Two']);
  });

  it('keeps heading expansion and skips the store write when the headings are unchanged', () => {
    seed('# One\n## Sub\n');
    const top = fileNode().children![1] as MarkdownHeadingNode;
    const rootBefore = useAS.getState().indexTreeRoot;
    setItemContent(FILE, '# One\n## Sub\nbody text\n', 1);
    expect(useAS.getState().indexTreeRoot).toBe(rootBefore);
    expect(fileNode().children![1]).toBe(top);

    // An expanded heading stays expanded across an edit that adds a sibling.
    const expanded = { ...top, isExpanded: true };
    useAS.setState({ indexTreeRoot: node('/r', true, true, [{ ...fileNode(), children: [fileNode().children![0]!, expanded] }]) });
    setItemContent(FILE, '# One\n## Sub\n# Two\n', 1);
    expect((fileNode().children![1] as MarkdownHeadingNode).isExpanded).toBe(true);
    expect(headingTexts(fileNode().children!)).toEqual(['One', 'Two']);
  });

  it('updates a loaded file inside an attach folder', () => {
    seed('# One\n', []);
    setItemContent(NESTED, '# Nested\n', 1);
    const nested = (fileNode().children![0] as FileNode).children![0] as FileNode;
    expect(headingTexts(nested.children!)).toEqual(['Nested']);
  });

  it('leaves a file whose children were never loaded alone', () => {
    seed('# One\n');
    const rootBefore = useAS.getState().indexTreeRoot;
    setItemContent(NESTED, '# Nested\n', 1);
    expect(useAS.getState().indexTreeRoot).toBe(rootBefore);
  });
});
