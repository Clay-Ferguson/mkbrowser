import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { customAlphabet } from 'nanoid';
import { parseFrontMatter } from './fileUtils';

const generateId = customAlphabet('0123456789ABCDEF', 9);

export type IndexEntry = { name: string; id?: string; create_time?: number; size?: number };

export interface IndexOptions {
  edit_mode?: boolean;
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
  const indexFilePath = path.join(dirPath, '.INDEX.yaml');
  try {
    const content = await fs.promises.readFile(indexFilePath, 'utf8');
    const parsed = yaml.load(content) as IndexYaml;
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch {
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
  const indexFilePath = path.join(dirPath, '.INDEX.yaml');
  let existingIndexContent: string | null = null;
  try {
    existingIndexContent = await fs.promises.readFile(indexFilePath, 'utf8');
  } catch {
    // No existing file
  }
  if (existingIndexContent === null && !createIfMissing) return;

  let dirEntries: import('fs').Dirent[];
  try {
    dirEntries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  // Mirror BrowseView's visibility rule: exclude hidden entries only
  const visibleEntries = dirEntries.filter((e) => !e.name.startsWith('.'));
  const visibleNames = new Set(visibleEntries.map((e) => e.name));

  // todo-0: we need to make sure that we're not actually reading the files every time we open a folder or run the reconcile function,
  // so for performance, I think we might need to have a global map which can allow us to assign a map entry every time we detect
  // or generate an ID associated with any markdown file.

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
      } catch {
        // Skip files that can't be stat'd
      }
    }
  }

  // For markdown files: ensure each has an id in its front matter; build bidirectional maps
  const nameToId = new Map<string, string>();
  const idToName = new Map<string, string>();

  for (const entry of visibleEntries) {
    if (!entry.isDirectory() && entry.name.toLowerCase().endsWith('.md')) {
      const filePath = path.join(dirPath, entry.name);
      try {
        const rawContent = await fs.promises.readFile(filePath, 'utf8');
        const { yaml: fm, content: body } = parseFrontMatter(rawContent);

        let fileId: string;
        if (fm?.id) {
          fileId = String(fm.id);
        } else {
          fileId = generateId();
          let newContent: string;
          if (!fm) {
            newContent = `---\nid: ${fileId}\n---\n${body}`;
          } else {
            const updated = { id: fileId, ...fm };
            newContent = `---\n${yaml.dump(updated)}---\n${body}`;
          }
          await fs.promises.writeFile(filePath, newContent, 'utf8');
        }
        nameToId.set(entry.name, fileId);
        idToName.set(fileId, entry.name);
      } catch {
        // Skip unreadable / unwritable files
      }
    }
  }

  // Parse existing index (already read above) or start fresh
  let files: IndexEntry[] = [];
  let existingOptions: IndexOptions = {};
  if (existingIndexContent !== null) {
    try {
      const parsed = yaml.load(existingIndexContent) as IndexYaml;
      if (parsed && Array.isArray(parsed.files)) files = parsed.files;
      if (parsed?.options && typeof parsed.options === 'object') existingOptions = parsed.options;
    } catch {
      // Parse error — start fresh
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

  const newContent = yaml.dump({ files, options: existingOptions }, { indent: 2 });
  if (newContent !== existingIndexContent) {
    await fs.promises.writeFile(indexFilePath, newContent, 'utf8');
  }
}

/**
 * Writes the options section of .INDEX.yaml, preserving the files array.
 */
export async function writeIndexOptions(
  dirPath: string,
  options: IndexOptions,
): Promise<{ success: boolean; error?: string }> {
  const indexFilePath = path.join(dirPath, '.INDEX.yaml');
  try {
    const existing = (await readIndexYaml(dirPath)) ?? {};
    const updated: IndexYaml = { ...existing, options: { ...existing.options, ...options } };
    await fs.promises.writeFile(indexFilePath, yaml.dump(updated, { indent: 2 }), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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
  const indexFilePath = path.join(dirPath, '.INDEX.yaml');
  try {
    const indexYaml = await readIndexYaml(dirPath);
    if (!indexYaml) return { success: false, error: '.INDEX.yaml not found or unreadable' };
    const files = indexYaml.files ?? [];

    const idx = files.findIndex((f) => f.name === name);
    if (idx === -1) return { success: false, error: `Entry "${name}" not found in index` };

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= files.length) return { success: true };

    [files[idx], files[swapIdx]] = [files[swapIdx], files[idx]];

    const newContent = yaml.dump({ ...indexYaml, files }, { indent: 2 });
    await fs.promises.writeFile(indexFilePath, newContent, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function moveToEdgeInIndexYaml(
  dirPath: string,
  name: string,
  edge: 'top' | 'bottom',
): Promise<{ success: boolean; error?: string }> {
  const indexFilePath = path.join(dirPath, '.INDEX.yaml');
  try {
    const indexYaml = await readIndexYaml(dirPath);
    if (!indexYaml) return { success: false, error: '.INDEX.yaml not found or unreadable' };
    const files = indexYaml.files ?? [];

    const idx = files.findIndex((f) => f.name === name);
    if (idx === -1) return { success: false, error: `Entry "${name}" not found in index` };

    const [entry] = files.splice(idx, 1);
    if (edge === 'top') {
      files.unshift(entry);
    } else {
      files.push(entry);
    }

    const newContent = yaml.dump({ ...indexYaml, files }, { indent: 2 });
    await fs.promises.writeFile(indexFilePath, newContent, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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
  const indexFilePath = path.join(dirPath, '.INDEX.yaml');
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

    const newContent = yaml.dump({ ...indexYaml, files }, { indent: 2 });
    await fs.promises.writeFile(indexFilePath, newContent, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
