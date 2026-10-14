import fs from 'node:fs';
import path from 'node:path';

/**
 * Command-line flag naming a file to open at startup in single-file mode (as if
 * the user had clicked it in the index tree): `--open-file=<path>`. A relative
 * path resolves against the folder being opened. Only the `=` form is accepted, so
 * the value can never be mistaken for the positional folder argument.
 */
export const OPEN_FILE_ARG = '--open-file';

/** The `--open-file=<path>` value among `args`, or undefined if absent or empty. */
export function getOpenFileArg(args: readonly string[]): string | undefined {
  const prefix = `${OPEN_FILE_ARG}=`;
  const value = args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
  return value || undefined;
}

/**
 * Resolves `filePath` against `rootFolder` and returns the absolute path, or null
 * when it is not an existing file inside `rootFolder` (single-file mode can only
 * show a file within the browsed tree).
 */
export async function resolveOpenFile(rootFolder: string, filePath: string): Promise<string | null> {
  const absolutePath = path.resolve(rootFolder, filePath);
  const relative = path.relative(rootFolder, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    const stat = await fs.promises.stat(absolutePath);
    return stat.isFile() ? absolutePath : null;
  } catch {
    return null;
  }
}
