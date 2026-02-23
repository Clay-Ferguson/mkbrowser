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

/** All tools available to the AI agent. */
export const aiTools = [readFileTool, listDirectoryTool];
