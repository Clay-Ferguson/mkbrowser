import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { scanFolderGraphLinks } from '../src/main/folderGraphLinks';

let root: string;
const p = (rel: string): string => path.join(root, rel);

function write(rel: string, content: string): void {
  fs.mkdirSync(path.dirname(p(rel)), { recursive: true });
  fs.writeFileSync(p(rel), content);
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'folderGraphLinks-test-'));
  write('a.md', [
    '[b](sub/b.md) [b again](sub/b.md#heading) [self](a.md)',
    '[[sub/c]] [folder](sub/) [missing](nope.md) [outside](../elsewhere.md)',
    '[space](sub/my%20note.md)',
  ].join('\n'));
  write('sub/b.md', '[up](../a.md) ![img](pic.png) [pic](pic.png)');
  write('sub/c.md', 'no links here');
  write('sub/my note.md', '');
  write('sub/pic.png', '');
  write('notes.txt', '[a](a.md)');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('scanFolderGraphLinks', () => {
  it('returns deduplicated edges to graph nodes only', async () => {
    const nodeIds = [root, p('a.md'), p('sub'), p('sub/b.md'), p('sub/c.md'), p('sub/my note.md'), p('sub/pic.png'), p('notes.txt')];
    const links = await scanFolderGraphLinks(root, nodeIds);
    expect(links).toEqual(expect.arrayContaining([
      { source: p('a.md'), target: p('sub/b.md') },
      { source: p('a.md'), target: p('sub/c.md') },
      { source: p('a.md'), target: p('sub') },
      { source: p('a.md'), target: p('sub/my note.md') },
      { source: p('sub/b.md'), target: p('a.md') },
      // A plain link to a non-Markdown node counts; the same file as an image doesn't add one.
      { source: p('sub/b.md'), target: p('sub/pic.png') },
    ]));
    // No self-link, nothing outside the node set, one edge per pair, and the
    // non-Markdown file is never read as a source.
    expect(links).toHaveLength(6);
  });

  it('only resolves an extensionless wikilink to .md when the literal path is not a node', async () => {
    write('w/x.md', '[[y]]');
    write('w/y.md', '');
    write('w/y', '');
    const both = await scanFolderGraphLinks(root, [p('w/x.md'), p('w/y'), p('w/y.md')]);
    expect(both).toEqual([{ source: p('w/x.md'), target: p('w/y') }]);
    const mdOnly = await scanFolderGraphLinks(root, [p('w/x.md'), p('w/y.md')]);
    expect(mdOnly).toEqual([{ source: p('w/x.md'), target: p('w/y.md') }]);
  });

  it('never reads a source id outside the scanned folder (though it may be a target)', async () => {
    const links = await scanFolderGraphLinks(p('sub'), [p('a.md'), p('sub/b.md'), p('sub/c.md')]);
    expect(links).toEqual([{ source: p('sub/b.md'), target: p('a.md') }]);
  });
});
