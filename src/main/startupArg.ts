import fs from 'node:fs';
import path from 'node:path';

/** What the positional command-line argument asks the app to open at startup. */
export interface StartupTarget {
  /** Absolute folder to browse as the root. */
  browseFolder: string;
  /** Absolute file to open in single-file mode, when the argument named a file. */
  file?: string;
}

/** True when `child` is `parent` itself or lies somewhere beneath it. */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Resolves the positional command-line argument (a folder or a file, relative to
 * the working directory or absolute) to what should open at startup, or null if it
 * does not exist.
 *
 * A folder becomes the browse root. A file opens in single-file mode: the saved
 * browse root is kept when it already contains the file (so its folder tree stays
 * in view); otherwise the file's own folder becomes the root.
 */
export async function resolveStartupArg(arg: string, savedBrowseFolder: string | undefined): Promise<StartupTarget | null> {
  const absolutePath = path.resolve(arg);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return { browseFolder: absolutePath };
  if (!stat.isFile()) return null;
  const browseFolder = savedBrowseFolder && isInside(savedBrowseFolder, absolutePath)
    ? savedBrowseFolder
    : path.dirname(absolutePath);
  return { browseFolder, file: absolutePath };
}
