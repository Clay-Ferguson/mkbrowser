/**
 * LangChain tools for the AI agent.
 * Provides read-only file system access scoped to the user's home directory.
 *
 * This module runs in the main process only — never import from the renderer.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getConfig } from '../configMgr';
import { logger } from '../utils/logUtil';

/** When true, log file-access tool invocations (file names read / listed) to the console. */
const DEBUG = true;

/** When false, all tool invocations throw immediately — an extra safeguard on top of AGENTIC_MODE. */
let toolsEnabled = true;

/** Enable or disable all AI tools at runtime. */
export function setToolsEnabled(enabled: boolean): void {
  toolsEnabled = enabled;
}

/** Maximum file size (in bytes) the mk_read_file tool will return.  Larger files are truncated. */
const MAX_READ_BYTES = 50 * 1024; // 50 KB

// ---------------------------------------------------------------------------
// Path validation helper
// ---------------------------------------------------------------------------

/**
 * Parse the agenticAllowedFolders config string into an array of absolute paths.
 * Splits on newlines, trims whitespace, and filters out blank lines.
 */
function getAllowedFolders(): string[] {
  const raw = getConfig().agenticAllowedFolders ?? '';
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Resolve `rawPath` to an absolute, symlink-resolved path and verify it lives
 * under one of the user-configured allowed folders.  Throws if the path is
 * outside every whitelisted folder or if no folders are configured.
 *
 * If the path contains a `*` wildcard (allowed only in the final path
 * component), the concrete directory prefix is validated recursively and the
 * result is the validated directory joined with the wildcard filename portion.
 */
export async function validatePath(rawPath: string): Promise<string> {
  // --- Wildcard handling (recursive) ---
  const starIdx = rawPath.indexOf('*');
  if (starIdx !== -1) {
    // Wildcards are only allowed in the last path component (the filename).
    if (rawPath.indexOf('/', starIdx) !== -1) {
      throw new Error(
        `Wildcards are only allowed in the filename portion of the path. "${rawPath}" has a wildcard in a directory component.`
      );
    }

    // Find the directory portion: everything before the last '/' preceding the '*'.
    const lastSlash = rawPath.lastIndexOf('/', starIdx);
    if (lastSlash === -1) {
      throw new Error(
        `Cannot determine directory for wildcard path "${rawPath}". Provide an absolute path.`
      );
    }

    const dirPortion = rawPath.substring(0, lastSlash);
    const wildcardPortion = rawPath.substring(lastSlash + 1); // e.g. "*.md"

    // Recursively validate the directory (guaranteed no '*' in dirPortion).
    const validatedDir = await validatePath(dirPortion);
    return path.join(validatedDir, wildcardPortion);
  }

  // --- Standard (non-wildcard) handling ---
  const allowedFolders = getAllowedFolders();

  if (allowedFolders.length === 0) {
    throw new Error(
      'Access denied: no allowed folders configured. Add at least one folder in Settings → AI Settings → Allowed Folders.'
    );
  }

  const resolved = path.resolve(rawPath);

  // Use realpath to chase symlinks so a cleverly placed link can't escape
  let real: string;
  try {
    real = await fs.realpath(resolved);
  } catch {
    // If realpath fails (file doesn't exist yet, broken symlink, etc.)
    // fall back to the resolved path for the prefix check.
    real = resolved;
  }

  // Check that the resolved path is under at least one allowed folder
  const isAllowed = allowedFolders.some((folder) => {
    const normalizedFolder = folder.endsWith('/') ? folder : folder + '/';
    return real === folder || real.startsWith(normalizedFolder);
  });

  if (!isAllowed) {
    throw new Error(
      `Access denied: "${rawPath}" resolves to "${real}" which is outside all allowed folders.`
    );
  }

  return real;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Delete one or more files matching a (possibly wildcard) path.
 * The path must already be validated via `validatePath`.
 * Returns the number of files deleted.  Throws if zero files match.
 */
async function globDelete(validatedPath: string): Promise<number> {
  const starIdx = validatedPath.indexOf('*');

  if (starIdx === -1) {
    // No wildcard — single-file delete.
    const stat = await fs.stat(validatedPath);
    if (!stat.isFile()) {
      throw new Error(`"${validatedPath}" is not a regular file.`);
    }
    await fs.unlink(validatedPath);
    return 1;
  }

  // Wildcard — split into directory + filename pattern.
  const dir = path.dirname(validatedPath);
  const pattern = path.basename(validatedPath);

  // Convert the simple wildcard pattern to a regex:
  // escape regex-special chars, then replace literal '*' with '.*'.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const matches = entries.filter((e) => e.isFile() && regex.test(e.name));

  if (matches.length === 0) {
    throw new Error(`No files matched the pattern "${pattern}" in "${dir}".`);
  }

  await Promise.all(matches.map((e) => fs.unlink(path.join(dir, e.name))));
  return matches.length;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/**
 * Read the contents of a file on the local file system.
 * The file must reside under the user's home directory (~/).
 */
export const readFileTool = tool(
  async ({ filePath }) => {
    if (!toolsEnabled) {
      throw new Error('AI tools are disabled (AGENTIC_MODE is off). mk_read_file cannot be called.');
    }
    const safe = await validatePath(filePath);
    if (DEBUG) logger.log(`[ai/tools] mk_read_file: ${path.basename(safe)}  (${safe})`);
    const stat = await fs.stat(safe);

    if (!stat.isFile()) {
      return `Error: "${filePath}" is not a regular file.`;
    }

    if (stat.size > MAX_READ_BYTES) {
      const buf = Buffer.alloc(MAX_READ_BYTES);
      const fh = await fs.open(safe, 'r');
      try {
        await fh.read(buf, 0, MAX_READ_BYTES, 0);
      } finally {
        await fh.close();
      }
      return (
        buf.toString('utf-8') +
        `\n\n--- (file truncated: showing first ${MAX_READ_BYTES} of ${stat.size} bytes) ---`
      );
    }

    return await fs.readFile(safe, 'utf-8');
  },
  {
    name: 'mk_read_file',
    description:
      'Read the contents of a file on the local file system. ' +
      'Provide an absolute path or a path starting with `~/`. ' +
      'Only files under the user\'s home directory are accessible.',
    schema: z.object({
      filePath: z
        .string()
        .describe('Absolute path (or ~/relative path) of the file to read.'),
    }),
  }
);

/**
 * List the contents of a directory on the local file system.
 * The directory must reside under the user's home directory (~/).
 */
export const listDirectoryTool = tool(
  async ({ directoryPath }) => {
    if (!toolsEnabled) {
      throw new Error('AI tools are disabled (AGENTIC_MODE is off). list_directory cannot be called.');
    }
    const safe = await validatePath(directoryPath);
    if (DEBUG) logger.log(`[ai/tools] list_directory: ${path.basename(safe)}  (${safe})`);
    const stat = await fs.stat(safe);

    if (!stat.isDirectory()) {
      return `Error: "${directoryPath}" is not a directory.`;
    }

    const entries = await fs.readdir(safe, { withFileTypes: true });
    if (entries.length === 0) {
      return '(empty directory)';
    }

    const lines = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => {
        if (e.isDirectory()) return `${e.name}/`;
        if (e.isSymbolicLink()) return `${e.name} -> (symlink)`;
        return e.name;
      });

    return lines.join('\n');
  },
  {
    name: 'list_directory',
    description:
      'List the files and subdirectories in a directory on the local file system. ' +
      'Provide an absolute path or a path starting with `~/`. ' +
      'Only directories under the user\'s home directory are accessible.',
    schema: z.object({
      directoryPath: z
        .string()
        .describe('Absolute path (or ~/relative path) of the directory to list.'),
    }),
  }
);

/**
 * Write content to an existing file on the local file system, replacing its
 * contents entirely.  The file must already exist and must reside under one of
 * the user-configured allowed folders.  This tool cannot create new files — if
 * the target path does not exist, an error is returned.
 */
export const writeFileTool = tool(
  async ({ filePath, content }) => {
    if (!toolsEnabled) {
      throw new Error('AI tools are disabled (AGENTIC_MODE is off). mk_write_file cannot be called.');
    }
    const safe = await validatePath(filePath);
    if (DEBUG) logger.log(`[ai/tools] mk_write_file: ${path.basename(safe)}  (${safe})`);

    // Ensure the file already exists — this tool must not create new files.
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(safe);
    } catch {
      throw new Error(
        `File not found: "${filePath}" does not exist. This tool can only overwrite existing files, not create new ones.`
      );
    }

    if (!stat.isFile()) {
      return `Error: "${filePath}" is not a regular file.`;
    }

    await fs.writeFile(safe, content, 'utf-8');
    return `Successfully wrote ${content.length} characters to ${filePath}`;
  },
  {
    name: 'mk_write_file',
    description:
      'Overwrite the contents of an existing file on the local file system. ' +
      'The file MUST already exist — this tool cannot create new files. ' +
      'Provide an absolute path or a path starting with `~/`. ' +
      'Only files under the user-configured allowed folders are accessible. ' +
      'The entire file content is replaced with the provided text.',
    schema: z.object({
      filePath: z
        .string()
        .describe('Absolute path (or ~/relative path) of the existing file to overwrite.'),
      content: z
        .string()
        .describe('The full new content to write to the file, replacing all existing content.'),
    }),
  }
);

/**
 * Create a new file on the local file system with the provided content.
 * The file must NOT already exist — this tool is for creating new files only.
 * The parent directory must exist and reside under one of the user-configured
 * allowed folders.
 */
export const createFileTool = tool(
  async ({ filePath, content }) => {
    if (!toolsEnabled) {
      throw new Error('AI tools are disabled (AGENTIC_MODE is off). create_file cannot be called.');
    }
    const resolved = path.resolve(filePath);

    // Validate the parent directory is under an allowed folder.
    const parentDir = path.dirname(resolved);
    await validatePath(parentDir);

    if (DEBUG) logger.log(`[ai/tools] create_file: ${path.basename(resolved)}  (${resolved})`);

    // Ensure the file does NOT already exist.
    try {
      await fs.stat(resolved);
      // If stat succeeds, the file exists — that's an error for this tool.
      throw new Error(
        `File already exists: "${filePath}". This tool can only create new files. ` +
        'Use mk_write_file to overwrite an existing file.'
      );
    } catch (err: unknown) {
      // Re-throw our own "already exists" error.
      if (err instanceof Error && err.message.startsWith('File already exists:')) {
        throw err;
      }
      // stat threw because the file doesn't exist — that's what we want.
    }

    // Ensure the parent directory exists.
    try {
      const parentStat = await fs.stat(parentDir);
      if (!parentStat.isDirectory()) {
        throw new Error(`Parent path "${parentDir}" is not a directory.`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('Parent path')) {
        throw err;
      }
      throw new Error(
        `Parent directory "${parentDir}" does not exist. Cannot create file.`
      );
    }

    await fs.writeFile(resolved, content, 'utf-8');
    return `Successfully created ${filePath} (${content.length} characters)`;
  },
  {
    name: 'create_file',
    description:
      'Create a new file on the local file system with the provided content. ' +
      'The file must NOT already exist — this tool cannot overwrite existing files. ' +
      'Use mk_write_file instead to update an existing file. ' +
      'Provide an absolute path or a path starting with `~/`. ' +
      'The parent directory must already exist and be under the user-configured allowed folders.',
    schema: z.object({
      filePath: z
        .string()
        .describe('Absolute path (or ~/relative path) for the new file to create. Must not already exist.'),
      content: z
        .string()
        .describe('The content to write to the new file.'),
    }),
  }
);

/**
 * Delete one or more files from the local file system.
 * Supports simple `*` wildcards in the filename portion of the path
 * (e.g. `/path/to/dir/*.md`).  The wildcard must only appear in the last
 * path component — using `*` in directory names is not allowed.
 * All matched paths must reside under the user-configured allowed folders.
 */
export const deleteFileTool = tool(
  async ({ filePath }) => {
    if (!toolsEnabled) {
      throw new Error('AI tools are disabled (AGENTIC_MODE is off). delete_file cannot be called.');
    }
    const validated = await validatePath(filePath);
    if (DEBUG) logger.log(`[ai/tools] delete_file: ${filePath}  (validated: ${validated})`);

    const count = await globDelete(validated);
    const dir = path.dirname(validated);
    return `Deleted ${count} file${count === 1 ? '' : 's'} from ${dir}`;
  },
  {
    name: 'delete_file',
    description:
      'Delete one or more files from the local file system. ' +
      'Supports simple `*` wildcards in the filename portion of the path ' +
      '(e.g. `/home/user/docs/*.tmp`). ' +
      'Wildcards are only allowed in the last path component — not in directory names. ' +
      'Only files under the user-configured allowed folders can be deleted. ' +
      'Directories cannot be deleted with this tool.',
    schema: z.object({
      filePath: z
        .string()
        .describe(
          'Absolute path of the file(s) to delete. ' +
          'May include a `*` wildcard in the filename (e.g. `/path/to/dir/*.log`).'
        ),
    }),
  }
);

/**
 * Delete a folder (and all of its contents) from the local file system.
 * The folder must reside under one of the user-configured allowed folders.
 * This performs a recursive delete — the folder does NOT need to be empty.
 */
export const deleteFolderTool = tool(
  async ({ folderPath }) => {
    if (!toolsEnabled) {
      throw new Error('AI tools are disabled (AGENTIC_MODE is off). delete_folder cannot be called.');
    }
    const safe = await validatePath(folderPath);
    if (DEBUG) logger.log(`[ai/tools] delete_folder: ${folderPath}  (validated: ${safe})`);

    const stat = await fs.stat(safe);
    if (!stat.isDirectory()) {
      throw new Error(`"${folderPath}" is not a directory. Use delete_file to remove regular files.`);
    }

    await fs.rm(safe, { recursive: true, force: true });
    return `Successfully deleted folder ${folderPath} and all of its contents.`;
  },
  {
    name: 'delete_folder',
    description:
      'Delete a folder and all of its contents (files and subdirectories) from the local file system. ' +
      'The folder does NOT need to be empty — all contents are removed recursively. ' +
      'Provide an absolute path or a path starting with `~/`. ' +
      'Only folders under the user-configured allowed folders can be deleted.',
    schema: z.object({
      folderPath: z
        .string()
        .describe('Absolute path (or ~/relative path) of the folder to delete.'),
    }),
  }
);

/** All tools available to the AI agent. */
export const aiTools = [readFileTool, listDirectoryTool, writeFileTool, createFileTool, deleteFileTool, deleteFolderTool];
