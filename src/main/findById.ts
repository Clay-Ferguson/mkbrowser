/**
 * Locates a Markdown file by the `id` in its front matter. Backs link auto-repair:
 * a link written as `[label](<dest> "id:3D6B20DDF")` whose destination no longer
 * exists is re-targeted at whichever `.md` file now carries that id.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fdir } from 'fdir';
import { buildExcludePredicate } from '../shared/pathPattern';

/** Bytes read from the head of each file. Ids are written first in the front
 * matter block (injectFrontMatterId), so the id line sits well inside this. */
const HEAD_BYTES = 8 * 1024;

/** Max number of files read concurrently while scanning. */
const FIND_CONCURRENCY = 16;

/** Matches a front-matter `id:` line, capturing the (optionally quoted) value. */
const ID_LINE_RE = /^id:\s*(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/;

const isMarkdown = (filePath: string): boolean => filePath.toLowerCase().endsWith('.md');

/**
 * True when `content` (the head of a file) opens with a front-matter block whose
 * top-level `id` equals `id`. Only lines up to the closing fence are examined, so
 * an `id:` line in the body never matches. Pure, for testability.
 */
export function headHasId(content: string, id: string): boolean {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trimEnd() !== '---') return false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trimEnd() === '---') return false;
    const m = ID_LINE_RE.exec(line);
    if (m) return (m[1] ?? m[2] ?? m[3]) === id;
  }
  return false;
}

/** Reads the first HEAD_BYTES of a file and checks it for the id. Unreadable files never match. */
async function fileHasId(filePath: string, id: string): Promise<boolean> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0);
    return headHasId(buf.toString('utf-8', 0, bytesRead), id);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Checks `files` with bounded concurrency and resolves to the first one found to
 * carry the id (or null). Workers stop pulling new files once any match is found.
 */
async function findFirstWithId(files: readonly string[], id: string): Promise<string | null> {
  let next = 0;
  let found: string | null = null;
  const worker = async () => {
    while (found === null && next < files.length) {
      const file = files[next++]!;
      if (await fileHasId(file, id)) found ??= file;
    }
  };
  await Promise.all(Array.from({ length: Math.min(FIND_CONCURRENCY, files.length) }, worker));
  return found;
}

/** The `.md` files directly inside `dir`; empty when the folder is missing or unreadable. */
async function listMarkdownChildren(dir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && isMarkdown(e.name) && !e.name.startsWith('.'))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Finds the `.md` file whose front-matter `id` is `id`. First looks in `likelyDir`
 * (the folder the broken link points into — the file was probably just renamed),
 * then crawls all of `rootDir` (it was probably moved), skipping hidden folders and
 * the user's ignored paths. The first match wins. Resolves to null when not found.
 */
export async function findMarkdownById(
  id: string,
  likelyDir: string,
  rootDir: string,
  ignoredPaths: string[],
): Promise<string | null> {
  const nearby = likelyDir ? await listMarkdownChildren(likelyDir) : [];
  const nearbyHit = await findFirstWithId(nearby, id);
  if (nearbyHit) return nearbyHit;

  if (!rootDir || !(await fs.promises.stat(rootDir).then((s) => s.isDirectory(), () => false))) {
    return null;
  }

  const shouldExclude = buildExcludePredicate(ignoredPaths);
  const checked = new Set(nearby);
  const all = await new fdir()
    .withFullPaths()
    .exclude((dirName, dirPath) => shouldExclude(dirName, dirPath))
    .filter((filePath) => isMarkdown(filePath) && !shouldExclude(path.basename(filePath), filePath))
    .crawl(rootDir)
    .withPromise();
  return findFirstWithId(all.filter((f) => !checked.has(f)), id);
}
