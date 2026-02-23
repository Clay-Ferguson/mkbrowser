/**
 * LangChain tools for the AI agent.
 * Provides read-only file system access scoped to the user's home directory.
 *
 * This module runs in the main process only — never import from the renderer.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfig } from '../configMgr';

/** When true, log file-access tool invocations (file names read / listed) to the console. */
const DEBUG = true;

/** When false, all tool invocations throw immediately — an extra safeguard on top of AGENTIC_MODE. */
let toolsEnabled = false;

/** Enable or disable all AI tools at runtime. */
export function setToolsEnabled(enabled: boolean): void {
  toolsEnabled = enabled;
}

/** Maximum file size (in bytes) the read_file tool will return.  Larger files are truncated. */
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
 */
async function validatePath(rawPath: string): Promise<string> {
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
// Tools
// ---------------------------------------------------------------------------

/**
 * Read the contents of a file on the local file system.
 * The file must reside under the user's home directory (~/).
 */
export const readFileTool = tool(
  async ({ filePath }) => {
    if (!toolsEnabled) {
      throw new Error('AI tools are disabled (AGENTIC_MODE is off). read_file cannot be called.');
    }
    const safe = await validatePath(filePath);
    if (DEBUG) console.log(`[ai/tools] read_file: ${path.basename(safe)}  (${safe})`);
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
    name: 'read_file',
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
    if (DEBUG) console.log(`[ai/tools] list_directory: ${path.basename(safe)}  (${safe})`);
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
      throw new Error('AI tools are disabled (AGENTIC_MODE is off). write_file cannot be called.');
    }
    const safe = await validatePath(filePath);
    if (DEBUG) console.log(`[ai/tools] write_file: ${path.basename(safe)}  (${safe})`);

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
    name: 'write_file',
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

    if (DEBUG) console.log(`[ai/tools] create_file: ${path.basename(resolved)}  (${resolved})`);

    // Ensure the file does NOT already exist.
    try {
      await fs.stat(resolved);
      // If stat succeeds, the file exists — that's an error for this tool.
      throw new Error(
        `File already exists: "${filePath}". This tool can only create new files. ` +
        'Use write_file to overwrite an existing file.'
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
      'Use write_file instead to update an existing file. ' +
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

/** All tools available to the AI agent. */
export const aiTools = [readFileTool, listDirectoryTool, writeFileTool, createFileTool];
