import path from 'node:path';
import fs from 'node:fs';
import type { FileEntry } from "../global";
import { logger } from '../shared/logUtil';
import { readAiHint } from './ai/aiHint';
import { readIndexYaml, compareByIndexOrder, renameInIndexYaml } from './indexUtil';
import { ATTACH_SUFFIX, INDEX_FILENAME } from '../shared/specialFiles';
import { compareNames } from '../shared/fileTypes';
import { mapWithConcurrency } from '../shared/asyncUtil';
import { isInsideOrEqual } from './htmlExport/exportPaths';

/**
 * Bound on concurrently processed directory entries. Each entry's task can hold
 * file descriptors open — readFile for AI hints, readdir/readFile in the
 * recursive .attach pre-load — so an unbounded `Promise.all` over a large
 * directory can exhaust the process fd limit (EMFILE). That failure mode is
 * especially nasty here because every per-entry error is deliberately swallowed
 * (best-effort listing): EMFILE doesn't crash, it silently drops aiHints and
 * attachments and routes stat failures into the fabricated-Date.now() fallback
 * below. Same bound and rationale as RECONCILE_FILE_CONCURRENCY in indexUtil.ts
 * and the other bounded fs fan-outs in this codebase. (Nested .attach recursion
 * gets its own budget per level, but attach nesting is shallow in practice.)
 */
const READDIR_CONCURRENCY = 32;

/**
 * Read directory contents and return FileEntry[] for the renderer.
 * Pure file-system logic — no Electron APIs.
 */
export async function readDirectory(dirPath: string, aiEnabled: boolean): Promise<FileEntry[]> {
  // First check if directory exists and is accessible
  let dirStat: fs.Stats;
  try {
    dirStat = await fs.promises.stat(dirPath);
  } catch (err) {
    throw new Error(`Cannot access directory: ${dirPath}`, { cause: err });
  }
  if (!dirStat.isDirectory()) {
    throw new Error(`Path is not a directory: ${dirPath}`);
  }

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const fileEntries: FileEntry[] = [];

  // Build each entry independently and resolve in parallel; the per-entry I/O
  // (stat, recursive reads, AI hints) is independent, so serial awaits here
  // would add up to N filesystem round-trips on large or slow directories.
  // Bounded (not Promise.all): see READDIR_CONCURRENCY — an unbounded fan-out
  // risks silent EMFILE degradation on large directories. mapWithConcurrency
  // preserves input order, and its fail-fast-on-rejection behavior is moot here
  // because this callback never rejects (every await inside is caught or
  // no-throw) — keep it that way, or one bad entry aborts the whole listing.
  const built = await mapWithConcurrency(entries, READDIR_CONCURRENCY, async (entry): Promise<FileEntry | null> => {
    // Skip hidden files/folders (starting with .)
    if (entry.name.startsWith('.')) return null;

    const fullPath = path.join(dirPath, entry.name);

    // stat() follows symlinks, so it resolves the real type for symlinks.
    // Dirent.isDirectory() does NOT follow symlinks on Linux.
    let modifiedTime = 0;
    let createdTime = 0;
    let size: number | undefined;
    let isDirectory = entry.isDirectory();
    try {
      const stat = await fs.promises.stat(fullPath);
      modifiedTime = stat.mtimeMs;
      createdTime = stat.birthtimeMs;
      size = stat.size;
      if (entry.isSymbolicLink()) {
        isDirectory = stat.isDirectory();
      }
    } catch (err) {
      // Broken symlink — skip it.
      if (entry.isSymbolicLink()) {
        logger.debug(`readDirectory: skipping broken symlink "${fullPath}": ${err}`);
        return null;
      }
      logger.debug(`readDirectory: stat failed for "${fullPath}", using current time: ${err}`);
      modifiedTime = Date.now();
      createdTime = Date.now();
    }

    const isMarkdown = !isDirectory && entry.name.toLowerCase().endsWith('.md');

    const fileEntry: FileEntry = {
      name: entry.name,
      path: fullPath,
      isDirectory,
      isMarkdown,
      modifiedTime,
      createdTime,
      size,
    };
    // Dirent comes from readdir, which doesn't follow links, so this is the entry
    // itself. Node reports Windows junctions as symlinks too.
    // See: (USER_GUIDE.md#symbolic-links)
    if (entry.isSymbolicLink()) fileEntry.isSymlink = true;

    // Pre-load contents of .attach folders so the renderer needs no extra I/O.
    // Symlinks never recurse: a link named "*.attach" that resolves to one of its
    // own ancestors makes this recursion fan out (bounded only by the kernel's
    // symlink-resolution limit, ~40 levels deep) and hang the main process.
    // Attach folders the app creates are always real directories.
    // See: (file_attachments.md#backend-file-system-scanning-srcmainfileutilts)
    if (isDirectory && !entry.isSymbolicLink() && entry.name.endsWith(ATTACH_SUFFIX)) {
      try {
        fileEntry.attachments = await readDirectory(fullPath, aiEnabled);
      } catch (err) {
        // Unreadable attach folder — leave attachments undefined
        logger.debug(`readDirectory: cannot read attach folder "${fullPath}": ${err}`);
      }
    }

    // Load AI conversation hint for H*/A* folders when aiEnabled
    // See: (ai_chat.md#how-the-thread-is-gathered)
    if (isDirectory && aiEnabled) {
      fileEntry.aiHint = await readAiHint(fullPath, entry.name);
    }

    return fileEntry;
  });

  for (const fileEntry of built) {
    if (fileEntry) fileEntries.push(fileEntry);
  }

  // Sort once, choosing the comparator based on whether an .INDEX is present.
  // An index defines an explicit order (with name as the tiebreaker); otherwise
  // we fall back to directories-first, then natural name order within each group.
  // See: (document_mode.md#the-indexyaml-file)
  const indexYaml = await readIndexYaml(dirPath);
  const indexFiles = indexYaml?.files;
  if (indexFiles) {
    // Order by the canonical .INDEX.yaml rule shared with document export
    // (getSortedDirEntries), so on-screen order can never diverge from exported
    // order for an indexed folder. (issue 015)
    const nameToOrder = new Map(indexFiles.map((f, i) => [f.name, i]));
    for (const entry of fileEntries) {
      const order = nameToOrder.get(entry.name);
      if (order !== undefined) entry.indexOrder = order;
    }
    const compare = compareByIndexOrder(indexFiles);
    fileEntries.sort((a, b) => compare(a.name, b.name));
  } else {
    fileEntries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return compareNames(a.name, b.name);
    });
  }

  // Mark files that have a sibling .attach folder so the GUI can skip the paperclip button
  // See: (file_attachments.md#backend-file-system-scanning-srcmainfileutilts)
  const attachNames = new Set(fileEntries.filter(e => e.isDirectory && e.name.endsWith(ATTACH_SUFFIX)).map(e => e.name));
  for (const entry of fileEntries) {
    if (!entry.isDirectory && attachNames.has(`${entry.name}${ATTACH_SUFFIX}`)) {
      entry.hasAttachFolder = true;
    }
  }

  return fileEntries;
}


/**
 * What a folder holds on disk, read with none of {@link readDirectory}'s
 * filtering — dotfiles and everything else the listing leaves out count.
 * - `empty`: no entries at all
 * - `indexOnly`: a regular file named .INDEX.yaml and nothing else — an empty
 *   Document Mode folder
 * - `hasContent`: anything else
 */
async function folderEmptiness(dirPath: string): Promise<'empty' | 'indexOnly' | 'hasContent'> {
  const dir = await fs.promises.opendir(dirPath);
  try {
    const first = await dir.read();
    if (first === null) return 'empty';
    if (first.name !== INDEX_FILENAME || !first.isFile()) return 'hasContent';
    return (await dir.read()) === null ? 'indexOnly' : 'hasContent';
  } finally {
    await dir.close();
  }
}

/**
 * The members of `paths` that are themselves symbolic links, in input order. Each is
 * checked with `lstat`, which looks at the path's last component without following
 * it; a path that can't be checked (missing, unreadable) counts as not a link.
 *
 * See: (USER_GUIDE.md#symbolic-links)
 */
export async function findSymlinks(paths: string[]): Promise<string[]> {
  const isLink = await Promise.all(paths.map((p) =>
    fs.promises.lstat(p).then((s) => s.isSymbolicLink(), () => false)
  ));
  return paths.filter((_, i) => isLink[i]);
}

/**
 * Creates, in `destFolder`, a symbolic link to `targetPath` with the target's own
 * name ("Paste Symlink"). The link stores the target's absolute path, so moving the
 * link elsewhere keeps it working. Linux and macOS only: on Windows, creating file
 * symlinks needs Developer Mode or admin rights, so the feature is not offered there.
 *
 * Refused, with nothing created:
 * - the target's own folder, where the link's name is the target's name;
 * - a folder target pasted into itself or anything beneath it (symlinks resolved),
 *   which would make an endlessly deep tree for every feature that walks folders;
 * - a name already taken in `destFolder`. `symlink` itself fails with EEXIST for any
 *   existing entry, a dangling link included, so there is no check-then-create race.
 *
 * See: (USER_GUIDE.md#creating-symbolic-links)
 */
export async function createSymlink(targetPath: string, destFolder: string): Promise<{ success: boolean; error?: string }> {
  if (process.platform === 'win32') {
    return { success: false, error: 'Creating symbolic links is not supported on Windows.' };
  }

  const target = path.resolve(targetPath);
  const folder = path.resolve(destFolder);
  const name = path.basename(target);

  let isDirectory: boolean;
  try {
    isDirectory = (await fs.promises.stat(target)).isDirectory();
  } catch {
    return { success: false, error: `"${name}" no longer exists.` };
  }

  if (path.dirname(target) === folder) {
    return { success: false, error: `"${name}" is already in that folder. Paste the link into a different folder.` };
  }

  if (isDirectory) {
    const [realTarget, realFolder] = await Promise.all([fs.promises.realpath(target), fs.promises.realpath(folder)]);
    if (isInsideOrEqual(realTarget, realFolder)) {
      return { success: false, error: `Cannot link "${name}" into itself or one of its own folders.` };
    }
  }

  try {
    await fs.promises.symlink(target, path.join(folder, name), isDirectory ? 'dir' : 'file');
    return { success: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return { success: false, error: `An item named "${name}" already exists in that folder.` };
    }
    throw err;
  }
}

/**
 * True when the folder is empty on disk, or holds only its .INDEX.yaml (an
 * empty Document Mode folder). Any other entry, hidden or not, makes it false.
 */
export async function isFolderEmpty(dirPath: string): Promise<boolean> {
  return (await folderEmptiness(dirPath)) !== 'hasContent';
}

/**
 * Permanently removes a folder, but only an empty one (see
 * {@link isFolderEmpty}). A lone .INDEX.yaml is deleted first; the two steps
 * are not atomic, so a failure of the second leaves the folder without its
 * index. Two independent guards protect everything else: the unfiltered check
 * here, and `rmdir` itself, which the OS rejects (ENOTEMPTY) for a folder that
 * has content — so a file that appears between the check and the delete still
 * cannot be lost. Never recursive.
 */
export async function deleteEmptyFolder(dirPath: string): Promise<void> {
  const state = await folderEmptiness(dirPath);
  if (state === 'hasContent') {
    throw new Error('Folder is not empty');
  }
  if (state === 'indexOnly') {
    await fs.promises.unlink(path.join(dirPath, INDEX_FILENAME));
  }
  await fs.promises.rmdir(dirPath);
}

/**
 * True when `newPath` is taken by an entry *other than* `oldPath`, i.e. when renaming
 * `oldPath` there would replace something. `fs.rename` silently overwrites its target
 * (on POSIX, and on Windows, where libuv passes MOVEFILE_REPLACE_EXISTING), so every
 * rename must ask this first.
 *
 * The destination is examined with `lstat`, so a symlink there — even a dangling one,
 * which `stat` would report as absent — counts as occupied. Only ENOENT means free; any
 * other failure to examine the destination is thrown rather than read as "nothing
 * there".
 *
 * The one occupant that is not "other" is the source itself, reached through a
 * case-only rename (`Readme.md` → `README.md`) on a case-insensitive filesystem
 * (NTFS/APFS), where both spellings resolve to the same entry. That exception is
 * limited to names differing only in case: two hard links share an inode too, but
 * renaming one onto the other is a no-op that would leave both names in place.
 */
async function isOccupiedByOtherEntry(oldPath: string, newPath: string): Promise<boolean> {
  let target: fs.Stats;
  try {
    target = await fs.promises.lstat(newPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
  if (oldPath.toLowerCase() !== newPath.toLowerCase()) return true;
  const source = await fs.promises.lstat(oldPath);
  return target.dev !== source.dev || target.ino !== source.ino;
}

/**
 * Renames (or moves) a file or folder, never replacing an existing entry at `newPath`
 * (see {@link isOccupiedByOtherEntry}). Resolves to false, having changed nothing, when
 * the destination is taken; rejects when the rename itself fails.
 *
 * A rename within one folder also keeps Document Mode and attachments in step: the
 * entry's .INDEX.yaml line is renamed, and so is its `.attach` folder (and that
 * folder's index line). The attach folder is carried along only when its own
 * destination is free, so it can never replace an existing folder; otherwise it is
 * left where it was under its old name. A move to another folder renames neither —
 * callers that move a file across folders move its `.attach` folder themselves.
 *
 * See: (file_attachments.md#rename-synchronization-srcmainfileutilts)
 * See: (USER_GUIDE.md#renaming-1)
 */
export async function renameEntry(oldPath: string, newPath: string): Promise<boolean> {
  if (oldPath === newPath) return true;
  if (await isOccupiedByOtherEntry(oldPath, newPath)) {
    logger.warn(`Refusing to rename ${oldPath} -> ${newPath}: a different entry already exists at the destination`);
    return false;
  }
  await fs.promises.rename(oldPath, newPath);

  const dirPath = path.dirname(oldPath);
  if (dirPath !== path.dirname(newPath)) return true;

  const oldName = path.basename(oldPath);
  const newName = path.basename(newPath);
  await renameInIndexYaml(dirPath, oldName, newName);

  const oldAttachPath = path.join(dirPath, `${oldName}${ATTACH_SUFFIX}`);
  const newAttachPath = path.join(dirPath, `${newName}${ATTACH_SUFFIX}`);
  try {
    await fs.promises.access(oldAttachPath);
  } catch {
    return true; // no attach folder — nothing more to carry along
  }
  try {
    if (await isOccupiedByOtherEntry(oldAttachPath, newAttachPath)) {
      logger.warn(`Renamed ${oldPath} but left its attach folder: ${newAttachPath} already exists`);
      return true;
    }
    await fs.promises.rename(oldAttachPath, newAttachPath);
    await renameInIndexYaml(dirPath, `${oldName}${ATTACH_SUFFIX}`, `${newName}${ATTACH_SUFFIX}`);
  } catch (err) {
    // The entry itself was renamed; a stranded attach folder is still intact on disk.
    logger.warn(`Renamed ${oldPath} but could not rename its attach folder:`, err);
  }
  return true;
}
