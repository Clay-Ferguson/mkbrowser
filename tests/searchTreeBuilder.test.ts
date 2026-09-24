/**
 * Tests for buildFolderGraphFromSearchResults (src/shared/searchTreeBuilder.ts):
 * turning a flat list of search results into the folder-graph shape.
 */
import { describe, it, expect } from 'vitest';
import { buildFolderGraphFromSearchResults } from '../src/shared/searchTreeBuilder';
import type { SearchResultItem } from '../src/shared/types';

const result = (p: string, extra: Partial<SearchResultItem> = {}): SearchResultItem =>
  ({ path: p, relativePath: p, matchCount: 1, ...extra });

describe('buildFolderGraphFromSearchResults', () => {
  it('draws file results as leaves under their common folder', () => {
    const graph = buildFolderGraphFromSearchResults([result('/root/a/x.md'), result('/root/b/y.md')]);
    expect(graph.folderPath).toBe('/root');
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    expect(byId.get('/root/a')?.isDirectory).toBe(true);
    expect(byId.get('/root/a/x.md')?.isDirectory).toBe(false);
    expect(graph.links).toContainEqual({ source: '/root/a', target: '/root/a/x.md' });
  });

  it('draws a folder result (from a File Names search) as a folder', () => {
    const graph = buildFolderGraphFromSearchResults([
      result('/root/notes/archive', { isDirectory: true }),
      result('/root/notes/today.md'),
    ]);
    const byId = new Map(graph.nodes.map(n => [n.id, n]));
    expect(byId.get('/root/notes/archive')?.isDirectory).toBe(true);
    expect(byId.get('/root/notes/today.md')?.isDirectory).toBe(false);
  });
});
