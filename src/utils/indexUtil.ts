import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { customAlphabet } from 'nanoid';
import { parseFrontMatter } from './fileUtils';

const generateId = customAlphabet('0123456789ABCDEF', 9);

/**
 * Reconciles a directory's .INDEX.yaml with the actual markdown files on disk.
 * - Ensures every .md file has a unique `id` in its YAML front matter.
 * - Creates .INDEX.yaml if it doesn't exist.
 * - Updates index entry names when an id match detects a rename.
 * - Appends any new files not yet listed in the index.
 */
export async function reconcileIndexedFiles(dirPath: string, createIfMissing = false): Promise<void> {
  // Check for .INDEX.yaml first — bail early for non-indexed folders unless creating
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
  let files: Array<{ name: string; id?: string }> = [];
  if (existingIndexContent !== null) {
    try {
      const parsed = yaml.load(existingIndexContent) as { files?: Array<{ name: string; id?: string }> };
      if (parsed && Array.isArray(parsed.files)) files = parsed.files;
    } catch {
      // Parse error — start fresh
    }
  }

  // Reconcile existing entries: detect renames via id, assign ids to untagged md entries
  const handledNames = new Set<string>();
  for (const entry of files) {
    if (entry.id) {
      const actualName = idToName.get(entry.id);
      if (actualName) {
        entry.name = actualName;
        handledNames.add(actualName);
      }
      // If no actualName: file was deleted — will be filtered out below
    } else {
      handledNames.add(entry.name);
      const id = nameToId.get(entry.name);
      if (id) entry.id = id;
    }
  }

  // Remove entries for files/folders that no longer exist on disk
  files = files.filter((entry) => {
    if (entry.id) return idToName.has(entry.id) || visibleNames.has(entry.name);
    return visibleNames.has(entry.name);
  });

  // Append visible entries not yet in the index (folders, images, PDFs, etc. get no id)
  for (const entry of visibleEntries) {
    if (!handledNames.has(entry.name)) {
      const id = nameToId.get(entry.name);
      const newEntry: { name: string; id?: string } = { name: entry.name };
      if (id) newEntry.id = id;
      files.push(newEntry);
    }
  }

  const newContent = yaml.dump({ files }, { indent: 2 });
  if (newContent !== existingIndexContent) {
    await fs.promises.writeFile(indexFilePath, newContent, 'utf8');
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
    let files: Array<{ name: string; id?: string }> = [];
    try {
      const content = await fs.promises.readFile(indexFilePath, 'utf8');
      const parsed = yaml.load(content) as { files?: Array<{ name: string; id?: string }> };
      if (parsed && Array.isArray(parsed.files)) files = parsed.files;
    } catch {
      // No existing file or parse error — start fresh
    }

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

    const newContent = yaml.dump({ files }, { indent: 2 });
    await fs.promises.writeFile(indexFilePath, newContent, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
