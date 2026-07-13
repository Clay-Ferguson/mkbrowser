/**
 * loadTags tests — the YAML parse here is deliberately NOT wrapped in a
 * try/catch (only the file read is), so a parse that throws escapes as an
 * unhandled rejection and takes the tag picker down with it. js-yaml 5 throws
 * on empty input, which makes an empty or comment-only tags.yaml — a perfectly
 * ordinary state, e.g. a file the user just created — exactly that case. These
 * tests pin that an unusable tags.yaml degrades to "no tags" instead.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadTags } from '../src/main/tagLoader';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tagloader-test-'));
});

afterEach(async () => {
  await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

async function writeTagsFile(content: string): Promise<void> {
  await fs.promises.writeFile(path.join(tmpDir, 'tags.yaml'), content);
}

describe('loadTags', () => {
  it('returns [] when tags.yaml does not exist', async () => {
    await expect(loadTags(tmpDir)).resolves.toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '  \n\n'],
    ['comments only', '# no tags defined yet\n'],
  ])('returns [] for a %s tags.yaml rather than throwing', async (_label, content) => {
    await writeTagsFile(content);
    await expect(loadTags(tmpDir)).resolves.toEqual([]);
  });

  it('returns [] when the top level has no hashtags key', async () => {
    await writeTagsFile('something: else\n');
    await expect(loadTags(tmpDir)).resolves.toEqual([]);
  });

  it('parses tag groups, sorted by tag name', async () => {
    await writeTagsFile(
      'hashtags:\n  food:\n    pizza:\n      description: Cheesy\n    apple:\n      description: Fruity\n',
    );

    await expect(loadTags(tmpDir)).resolves.toEqual([
      {
        name: 'food',
        tags: [
          { tag: '#apple', description: 'Fruity' },
          { tag: '#pizza', description: 'Cheesy' },
        ],
      },
    ]);
  });
});
