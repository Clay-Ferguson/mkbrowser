import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { analyzeFolderHashtags } from '../src/main/folderAnalysis';

// See: (USER_GUIDE.md#folder-analysis)
describe('analyzeFolderHashtags', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mkb-analysis-'));
    const write = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), text);
    };
    // Front matter tags only.
    write('a.md', '---\ntags:\n  - purchased\n  - todo\n---\nmy test file\n');
    // Both kinds; a duplicate front matter tag counts once for the file, and
    // body hashtags count every occurrence.
    write('sub/b.md', '---\ntags: [todo, todo, 2024]\ntitle: "about #notatag"\n---\n#todo now, #todo later, #todos\n');
    // Content hashtags only, in a .txt file.
    write('c.txt', 'x#nope #idea\n#idea');
    // Malformed front matter: no properties tags, body still scanned.
    write('d.md', '---\ntags: [unclosed\n---\n#broken-yaml\n');
    // Not scanned.
    write('e.json', '{"tags": ["skip"], "x": "#skip"}');
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('counts content hashtags by occurrence and properties tags by file, separately', async () => {
    const result = await analyzeFolderHashtags(dir);
    expect(result.totalFiles).toBe(4);
    expect(result.hashtags).toEqual([
      { tag: '#idea', count: 2 },
      { tag: '#todo', count: 2 },
      { tag: '#broken-yaml', count: 1 },
      { tag: '#todos', count: 1 },
    ]);
    expect(result.propertyTags).toEqual([
      { tag: 'todo', count: 2 },
      { tag: '2024', count: 1 },
      { tag: 'purchased', count: 1 },
    ]);
  });

  it('skips ignored paths', async () => {
    const result = await analyzeFolderHashtags(dir, ['sub']);
    expect(result.totalFiles).toBe(3);
    expect(result.propertyTags).toEqual([
      { tag: 'purchased', count: 1 },
      { tag: 'todo', count: 1 },
    ]);
  });
});
