import fs from 'node:fs';
import path from 'node:path';
import { load, dump } from 'js-yaml';
import { customAlphabet } from 'nanoid';
import { parseFrontMatter } from './fileUtil';
import { ATTACH_SUFFIX, INDEX_FILENAME } from './specialFiles';
import { writeFileAtomic } from './atomicWrite';
import { logger } from './logUtil';

const generateId = customAlphabet('0123456789ABCDEF', 9);

/**
 * Shared options for every js-yaml `dump()` in this module.
 *
 * `lineWidth: -1` disables js-yaml's default 80-column line folding so long
 * filenames (in the `files` list) and long user-authored front-matter values
 * (titles, descriptions, URLs) are never wrapped/reflowed on a routine write —
 * matching the convention already used in tagUtil.ts and joinUtil.ts.
 * `noRefs: true` avoids emitting YAML anchors/aliases for duplicate references.
 */
const YAML_DUMP_OPTS = { indent: 2, lineWidth: -1, noRefs: true } as const;

/** Absolute path to the .INDEX.yaml file for a given directory. */
function indexPathFor(dirPath: string): string {
  return path.join(dirPath, INDEX_FILENAME);
}

/**
 * True when an fs error is the ordinary "file does not exist" case. A missing
 * .INDEX.yaml simply means the directory isn't in Document Mode, so callers
 * treat ENOENT as expected (and silent) while logging any other errno.
 */
function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

export type IndexEntry = { name: string; id?: string; create_time?: number; size?: number };

export interface IndexOptions {
  [key: string]: unknown;
}

export interface IndexYaml {
  files?: IndexEntry[];
  options?: IndexOptions;
}

/**
 * Reads and parses .INDEX.yaml from dirPath. Returns the parsed object, or null
 * if the file doesn't exist or can't be parsed.
 */
export async function readIndexYaml(dirPath: string): Promise<IndexYaml | null> {
  const indexFilePath = indexPathFor(dirPath);
  try {
    const content = await fs.promises.readFile(indexFilePath, 'utf8');
    const parsed = load(content) as IndexYaml;
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch (err) {
    // A missing index is the normal "not Document Mode" case; anything else
    // (malformed YAML, EACCES, …) is worth surfacing.
    if (!isENOENT(err)) {
      logger.warn(`readIndexYaml: cannot read/parse "${indexFilePath}": ${err}`);
    }
    return null;
  }
}

/**
 * Reconciles a directory's .INDEX.yaml with the actual markdown files on disk.
 * - Ensures every .md file has a unique `id` in its YAML front matter.
 * - Creates .INDEX.yaml if it doesn't exist.
 * - Updates index entry names when an id match detects a rename.
 * - Appends any new files not yet listed in the index.
 */
export async function reconcileIndexedFiles(dirPath: string, createIfMissing = false): Promise<void> {
  const indexFilePath = indexPathFor(dirPath);
  let existingIndexContent: string | null = null;
  try {
    existingIndexContent = await fs.promises.readFile(indexFilePath, 'utf8');
  } catch (err) {
    // A missing index is normal (the file may be created below); log anything else.
    if (!isENOENT(err)) {
      logger.debug(`reconcileIndexedFiles: cannot read "${indexFilePath}": ${err}`);
    }
  }
  if (existingIndexContent === null && !createIfMissing) return;

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    // Can't list the directory — reconciliation can't proceed at all.
    logger.warn(`reconcileIndexedFiles: cannot read directory "${dirPath}": ${err}`);
    return;
  }

  // Mirror BrowseView's visibility rule: exclude hidden entries only
  const visibleEntries = dirEntries.filter((e) => !e.name.startsWith('.'));
  const visibleNames = new Set(visibleEntries.map((e) => e.name));

  // For non-markdown files: stat each one to build a fingerprint map keyed by "createTime:size:ext".
  // This lets us detect renames of non-markdown files during reconciliation.
  const nameToStat = new Map<string, { createTime: number; size: number }>();
  const fingerprintToVisibleName = new Map<string, string>();
  for (const entry of visibleEntries) {
    if (!entry.isDirectory() && !entry.name.toLowerCase().endsWith('.md')) {
      try {
        const stat = await fs.promises.stat(path.join(dirPath, entry.name));
        const createTime = Math.round(stat.birthtimeMs);
        const size = stat.size;
        nameToStat.set(entry.name, { createTime, size });
        const ext = path.extname(entry.name).toLowerCase();
        fingerprintToVisibleName.set(`${createTime}:${size}:${ext}`, entry.name);
      } catch (err) {
        // Skip files that can't be stat'd (no fingerprint → rename detection skipped for it).
        logger.debug(
          `reconcileIndexedFiles: stat failed for "${path.join(dirPath, entry.name)}": ${err}`,
        );
      }
    }
  }

  // For markdown files: ensure each has an id in its front matter; build bidirectional maps.
  const nameToId = new Map<string, string>();
  const idToName = new Map<string, string>();

  // Collect markdown files with their creation time so we can process them
  // oldest-first. When two files share an id (e.g. a copy/paste duplicated the
  // front matter), the oldest file keeps the id and any newer duplicate is
  // re-keyed — so a freshly pasted copy is the one that gets a fresh id, while
  // the original keeps its identity (and its existing .INDEX.yaml entry).
  const markdownFiles: Array<{ name: string; createTime: number }> = [];
  for (const entry of visibleEntries) {
    if (!entry.isDirectory() && entry.name.toLowerCase().endsWith('.md')) {
      let createTime = 0;
      try {
        createTime = (await fs.promises.stat(path.join(dirPath, entry.name))).birthtimeMs;
      } catch (err) {
        // If stat fails, treat as oldest (0) — best effort.
        logger.debug(
          `reconcileIndexedFiles: stat failed for "${path.join(dirPath, entry.name)}", treating as oldest: ${err}`,
        );
      }
      markdownFiles.push({ name: entry.name, createTime });
    }
  }
  // Oldest first; tie-break by name so ordering (and thus which file keeps a
  // shared id) is deterministic when creation times are equal.
  markdownFiles.sort((a, b) => a.createTime - b.createTime || a.name.localeCompare(b.name));

  for (const { name } of markdownFiles) {
    const filePath = path.join(dirPath, name);
    try {
      const rawContent = await fs.promises.readFile(filePath, 'utf8');
      const { yaml: fm, content: body } = parseFrontMatter(rawContent);

      // A file needs a fresh id when it has none, or when its id is already
      // claimed by an older file. Filenames are unique within a directory, so a
      // hit in idToName here means a true duplicate id — e.g. a copy/paste that
      // carried the source file's front-matter id. Re-key the (newer) duplicate
      // so the per-directory uniqueness invariant rename detection relies on holds.
      let fileId = fm?.id ? String(fm.id) : undefined;
      const collidingName = fileId ? idToName.get(fileId) : undefined;
      if (!fileId || collidingName !== undefined) {
        if (fileId && collidingName !== undefined) {
          logger.warn(
            `reconcileIndexedFiles: duplicate front-matter id "${fileId}" in "${name}" (already used by older file "${collidingName}"); assigning a new id`,
          );
        }
        // Generate an id not already in use in this directory.
        do {
          fileId = generateId();
        } while (idToName.has(fileId));

        let newContent: string;
        if (!fm) {
          newContent = `---\nid: ${fileId}\n---\n${body}`;
        } else {
          // Strip any existing id and re-add it first so the new value wins
          // and stays at the top of the front matter.
          const { id: _oldId, ...rest } = fm;
          const updated = { id: fileId, ...rest };
          newContent = `---\n${dump(updated, YAML_DUMP_OPTS)}---\n${body}`;
        }
        await writeFileAtomic(filePath, newContent);
      }
      nameToId.set(name, fileId);
      idToName.set(fileId, name);
    } catch (err) {
      // Skip unreadable / unwritable files (no id assigned → excluded from rename detection).
      logger.debug(`reconcileIndexedFiles: cannot read/update "${filePath}": ${err}`);
    }
  }

  // Parse existing index (already read above) or start fresh
  let files: IndexEntry[] = [];
  let existingOptions: IndexOptions = {};
  if (existingIndexContent !== null) {
    try {
      const parsed = load(existingIndexContent) as IndexYaml;
      if (parsed && Array.isArray(parsed.files)) files = parsed.files;
      if (parsed?.options && typeof parsed.options === 'object') existingOptions = parsed.options;
    } catch (err) {
      // Corrupt index — start fresh (the rebuilt index will overwrite it).
      logger.warn(`reconcileIndexedFiles: malformed "${indexFilePath}", rebuilding: ${err}`);
    }
  }

  // Reconcile existing entries: detect renames via id (markdown) or fingerprint (non-markdown)
  const handledNames = new Set<string>();
  for (const entry of files) {
    if (entry.id) {
      // Markdown entry: match by id to detect renames
      const actualName = idToName.get(entry.id);
      if (actualName) {
        entry.name = actualName;
        handledNames.add(actualName);
      }
      // If no actualName: file was deleted — will be filtered out below
    } else if (entry.create_time !== undefined && entry.size !== undefined) {
      // Fingerprinted non-markdown entry: match by (create_time, size, ext) to detect renames
      const ext = path.extname(entry.name).toLowerCase();
      const actualName = fingerprintToVisibleName.get(`${entry.create_time}:${entry.size}:${ext}`);
      if (actualName) {
        entry.name = actualName;
        handledNames.add(actualName);
      }
      // If no actualName: file was deleted — will be filtered out below
    } else {
      // Name-only entry (folder or old-style non-markdown without fingerprint)
      handledNames.add(entry.name);
      const id = nameToId.get(entry.name);
      if (id) entry.id = id;
    }
  }

  // Remove entries for files/folders that no longer exist on disk
  files = files.filter((entry) => {
    if (entry.id) return idToName.has(entry.id) || visibleNames.has(entry.name);
    if (entry.create_time !== undefined && entry.size !== undefined) {
      const ext = path.extname(entry.name).toLowerCase();
      return fingerprintToVisibleName.has(`${entry.create_time}:${entry.size}:${ext}`);
    }
    return visibleNames.has(entry.name);
  });

  // Append visible entries not yet in the index.
  // Markdown files get an id; non-markdown files get a create_time+size fingerprint for rename detection.
  for (const entry of visibleEntries) {
    if (!handledNames.has(entry.name)) {
      const newEntry: IndexEntry = { name: entry.name };
      const id = nameToId.get(entry.name);
      if (id) {
        newEntry.id = id;
      } else if (!entry.isDirectory()) {
        const stat = nameToStat.get(entry.name);
        if (stat) {
          newEntry.create_time = stat.createTime;
          newEntry.size = stat.size;
        }
      }
      files.push(newEntry);
    }
  }

  const newContent = dump({ files, options: existingOptions }, YAML_DUMP_OPTS);
  if (newContent !== existingIndexContent) {
    await writeFileAtomic(indexFilePath, newContent);
  }
}

/**
 * Writes the options section of .INDEX.yaml, preserving the files array.
 */
export async function writeIndexOptions(
  dirPath: string,
  options: IndexOptions,
): Promise<{ success: boolean; error?: string }> {
  const indexFilePath = indexPathFor(dirPath);
  try {
    const existing = (await readIndexYaml(dirPath)) ?? {};
    const updated: IndexYaml = { ...existing, options: { ...existing.options, ...options } };
    await writeFileAtomic(indexFilePath, dump(updated, YAML_DUMP_OPTS));
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Ensures every "*.attach" folder entry in a files array immediately follows its
 * associated file entry. Returns a new array if any reordering was needed, or
 * the original array reference if nothing changed.
 *
 * Algorithm:
 *  1. Partition entries into attach entries (attMap keyed by name) and non-attach entries.
 *  2. Rebuild the list by emitting each non-attach entry followed by its attach sibling (if any).
 *  3. Append any orphaned attach entries at the end (shouldn't happen, but handles edge cases).
 */
function reorderAttachFolders(files: IndexEntry[]): IndexEntry[] {
  const attMap = new Map<string, IndexEntry>();
  const nonAttach: IndexEntry[] = [];

  for (const entry of files) {
    if (entry.name.endsWith(ATTACH_SUFFIX)) {
      attMap.set(entry.name, entry);
    } else {
      nonAttach.push(entry);
    }
  }

  const finalFiles: IndexEntry[] = [];
  for (const entry of nonAttach) {
    finalFiles.push(entry);
    const attachName = `${entry.name}${ATTACH_SUFFIX}`;
    const attachEntry = attMap.get(attachName);
    if (attachEntry) {
      finalFiles.push(attachEntry);
      attMap.delete(attachName);
    }
  }
  // Append any orphaned attach entries
  for (const orphan of attMap.values()) {
    finalFiles.push(orphan);
  }

  // Detect change by comparing name sequences
  const changed = finalFiles.some((e, i) => e.name !== files[i]?.name);
  return changed ? finalFiles : files;
}

/**
 * Reads .INDEX.yaml and reorders any out-of-place "*.attach" folder entries so
 * each immediately follows its associated file. Writes back only if changed.
 */
export async function validateAttachFolderLocation(dirPath: string): Promise<void> {
  const indexFilePath = indexPathFor(dirPath);
  try {
    const indexYaml = await readIndexYaml(dirPath);
    if (!indexYaml?.files) return;

    const reordered = reorderAttachFolders(indexYaml.files);
    if (reordered === indexYaml.files) return; // no change

    await writeFileAtomic(
      indexFilePath,
      dump({ ...indexYaml, files: reordered }, YAML_DUMP_OPTS),
    );
  } catch (err) {
    // Best-effort; record the failed reorder but don't throw.
    logger.warn(`validateAttachFolderLocation: failed to reorder "${indexFilePath}": ${err}`);
  }
}

/**
 * Moves an entry up or down one position in .INDEX.yaml by swapping it with its neighbor.
 */
export async function moveInIndexYaml(
  dirPath: string,
  name: string,
  direction: 'up' | 'down',
): Promise<{ success: boolean; error?: string }> {
  const indexFilePath = indexPathFor(dirPath);
  try {
    const indexYaml = await readIndexYaml(dirPath);
    if (!indexYaml) return { success: false, error: `${INDEX_FILENAME} not found or unreadable` };
    const files = indexYaml.files ?? [];

    const idx = files.findIndex((f) => f.name === name);
    if (idx === -1) return { success: false, error: `Entry "${name}" not found in index` };

    let swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= files.length) return { success: true };

    // Skip over any attach folder at the swap target — landing on one would be
    // immediately undone by validateAttachFolderLocation.
    if (files[swapIdx].name.endsWith(ATTACH_SUFFIX)) {
      swapIdx = direction === 'up' ? swapIdx - 1 : swapIdx + 1;
      if (swapIdx < 0 || swapIdx >= files.length) return { success: true };
    }

    [files[idx], files[swapIdx]] = [files[swapIdx], files[idx]];

    const newContent = dump({ ...indexYaml, files }, YAML_DUMP_OPTS);
    await writeFileAtomic(indexFilePath, newContent);
    await validateAttachFolderLocation(dirPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Does the 'move to top' and 'move to bottom' of a file
 */
export async function moveToEdgeInIndexYaml(
  dirPath: string,
  name: string,
  edge: 'top' | 'bottom',
): Promise<{ success: boolean; error?: string }> {
  const indexFilePath = indexPathFor(dirPath);
  try {
    const indexYaml = await readIndexYaml(dirPath);
    if (!indexYaml) return { success: false, error: `${INDEX_FILENAME} not found or unreadable` };
    const files = indexYaml.files ?? [];

    const idx = files.findIndex((f) => f.name === name);
    if (idx === -1) return { success: false, error: `Entry "${name}" not found in index` };

    const [entry] = files.splice(idx, 1);
    if (edge === 'top') {
      files.unshift(entry);
    } else {
      files.push(entry);
    }

    const newContent = dump({ ...indexYaml, files }, YAML_DUMP_OPTS);
    await writeFileAtomic(indexFilePath, newContent);
    await validateAttachFolderLocation(dirPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Returns the visible entries of a directory in document-mode order when a
 * .INDEX.yaml exists, or alphabetically when it does not.
 *
 * "Visible" means non-hidden (name does not start with '.').
 * The returned objects carry `name`, `entryPath`, and `isDir` so callers
 * don't need a second readdir call.
 */
export async function getSortedDirEntries(
  dirPath: string,
): Promise<Array<{ name: string; entryPath: string; isDir: boolean }>> {
  const dirEntries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const visible = dirEntries.filter((e) => !e.name.startsWith('.'));

  const toItem = (e: fs.Dirent) => ({
    name: e.name,
    entryPath: path.join(dirPath, e.name),
    isDir: e.isDirectory(),
  });

  const indexYaml = await readIndexYaml(dirPath);
  if (!indexYaml?.files?.length) {
    // No document mode — alphabetical fallback
    return visible
      .map(toItem)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  // Build a lookup from name → Dirent for fast access
  const nameMap = new Map(visible.map((e) => [e.name, e]));

  // Emit entries in index order, then any extras not listed in the index alphabetically
  const ordered: Array<{ name: string; entryPath: string; isDir: boolean }> = [];
  const seen = new Set<string>();
  for (const entry of indexYaml.files) {
    const dirent = nameMap.get(entry.name);
    if (dirent) {
      ordered.push(toItem(dirent));
      seen.add(entry.name);
    }
  }
  // Append any disk entries not present in the index (new files not yet reconciled)
  for (const e of visible) {
    if (!seen.has(e.name)) {
      ordered.push(toItem(e));
    }
  }

  return ordered;
}

/**
 * Ensures a markdown file's content has a front-matter `id` field when the
 * file lives in a Document Mode folder (i.e. a sibling .INDEX.yaml exists).
 *
 * Returns the (possibly modified) content string. If an id was added, the
 * .INDEX.yaml entry for this filename is updated to record the new id so that
 * rename detection continues to work.
 *
 * Safe to call unconditionally on every .md save — it is a no-op when:
 *   - the directory has no .INDEX.yaml, or
 *   - the file already has an id in its front matter.
 */
export async function ensureFrontMatterIdIfIndexed(
  filePath: string,
  content: string,
): Promise<string> {
  const dirPath = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const indexFilePath = indexPathFor(dirPath);

  // Check if this folder is in Document Mode
  let indexYaml: IndexYaml | null = null;
  try {
    const raw = await fs.promises.readFile(indexFilePath, 'utf8');
    const parsed = load(raw) as IndexYaml;
    if (parsed && typeof parsed === 'object') indexYaml = parsed;
  } catch (err) {
    // A missing index is the normal "not Document Mode" case; surface anything else.
    if (!isENOENT(err)) {
      logger.warn(`ensureFrontMatterIdIfIndexed: cannot read/parse "${indexFilePath}": ${err}`);
    }
    return content; // no usable .INDEX.yaml — nothing to do
  }
  if (!indexYaml) return content;

  // Parse existing front matter
  const { yaml: fm, content: body } = parseFrontMatter(content);
  if (fm?.id) return content; // already has an id

  // Generate a new id and inject it into the front matter
  const fileId = generateId();
  let newContent: string;
  if (!fm) {
    newContent = `---\nid: ${fileId}\n---\n${body}`;
  } else {
    const updated = { id: fileId, ...fm };
    newContent = `---\n${dump(updated, YAML_DUMP_OPTS)}---\n${body}`;
  }

  // Update the .INDEX.yaml entry for this file to record the id
  const files = indexYaml.files ?? [];
  const entry = files.find((f) => f.name === fileName);
  if (entry) {
    entry.id = fileId;
    const newIndexContent = dump({ ...indexYaml, files }, YAML_DUMP_OPTS);
    await writeFileAtomic(indexFilePath, newIndexContent);
  }

  return newContent;
}

/**
 * Renames an entry in .INDEX.yaml from oldName to newName.
 * No-op if .INDEX.yaml doesn't exist or oldName isn't found.
 */
export async function renameInIndexYaml(
  dirPath: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const indexFilePath = indexPathFor(dirPath);
  try {
    const indexYaml = await readIndexYaml(dirPath);
    if (!indexYaml?.files) return;
    const entry = indexYaml.files.find((f) => f.name === oldName);
    if (!entry) return;
    entry.name = newName;
    await writeFileAtomic(indexFilePath, dump(indexYaml, YAML_DUMP_OPTS));
  } catch (err) {
    // Best-effort; record the failed index update but don't throw.
    logger.warn(`renameInIndexYaml: failed to rename "${oldName}" → "${newName}" in "${indexFilePath}": ${err}`);
  }
}

/**
 * Inserts a new entry into the .INDEX.yaml files array at the position
 * immediately after insertAfterName (or at position 0 when null).
 * Existing entries and their id fields are preserved.
 */
export async function insertIntoIndexYaml(
  dirPath: string,
  newName: string,
  insertAfterName: string | null,
): Promise<{ success: boolean; error?: string }> {
  const indexFilePath = indexPathFor(dirPath);
  try {
    const indexYaml = (await readIndexYaml(dirPath)) ?? {};
    const files = indexYaml.files ?? [];

    const newEntry: { name: string } = { name: newName };
    if (insertAfterName === null) {
      files.unshift(newEntry);
    } else {
      const idx = files.findIndex((f) => f.name === insertAfterName);
      if (idx === -1) {
        files.push(newEntry);
      } else {
        files.splice(idx + 1, 0, newEntry);
      }
    }

    const newContent = dump({ ...indexYaml, files }, YAML_DUMP_OPTS);
    await writeFileAtomic(indexFilePath, newContent);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
