/**
 * Ids carried in a file's name — `report--3D6B20DDF.pdf` — for files that have no front
 * matter to hold one (PDFs, images, any non-Markdown file). A link to such a file is an
 * ordinary link whose destination ends in the id, so when the file is later renamed or
 * moved (keeping its `--ID` and extension) the link can be repaired by finding the file
 * carrying that id (linkRepair.ts, findById.ts). Markdown files carry their id in front
 * matter instead, so their names are never read for one.
 */
import { customAlphabet } from 'nanoid';
import { isMarkdownFile } from './fileTypes';

/**
 * Generates a fresh id: 9 uppercase hex characters. Shared by front-matter ids
 * (indexUtil.injectFrontMatterId) and file-name ids, so the two look alike.
 */
export const generateFileId = customAlphabet('0123456789ABCDEF', 9);

/**
 * A file name ending in `--` + a 9-hex-character id, right before the last extension (or
 * at the very end when there is none). Deliberately strict: names like the timestamp
 * file names `2026-10-25--03-04-05-PM.png` also contain `--` and must not count.
 * Groups: 1 the base name, 2 the id, 3 the extension (with its dot), if any.
 */
const FILE_ID_SUFFIX_RE = /^(.+)--([0-9A-F]{9})(\.[^.]+)?$/;

/** The parts of a file name that carries an id. */
export interface FileIdSuffix {
  /** The name before the `--ID`. */
  base: string;
  id: string;
  /** The extension with its dot (`.pdf`), or '' when the name has none. */
  ext: string;
}

/** The last segment of a path, with either separator. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? '';
}

/** Splits the file name `name` into its base, `--ID` and extension, or null when it carries no id. */
export function parseFileIdSuffix(name: string): FileIdSuffix | null {
  const m = FILE_ID_SUFFIX_RE.exec(name);
  return m ? { base: m[1]!, id: m[2]!, ext: m[3] ?? '' } : null;
}

/** `name` with `--<id>` inserted before its extension: `report.pdf` → `report--<id>.pdf`, `Makefile` → `Makefile--<id>`. */
export function withFileIdSuffix(name: string, id: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}--${id}${name.slice(dot)}` : `${name}--${id}`;
}

/** `name` without its `--ID` (`report--3D6B20DDF.pdf` → `report.pdf`), or `name` itself when it carries none. */
export function stripFileIdSuffix(name: string): string {
  const parsed = parseFileIdSuffix(name);
  return parsed ? parsed.base + parsed.ext : name;
}

/**
 * The id carried in the name of the non-Markdown file at `path`, or null when it has
 * none. Always null for a Markdown file, whose id lives in its front matter.
 */
export function fileIdSuffixOf(path: string): FileIdSuffix | null {
  const name = baseName(path);
  return isMarkdownFile(name) ? null : parseFileIdSuffix(name);
}

/**
 * True when renaming a non-Markdown file from `oldName` to `newName` would stop links to
 * it from repairing themselves: `oldName` carries an id and `newName` drops or changes
 * it, or changes the extension (compared ignoring case, since `.PDF` → `.pdf` is the
 * same type).
 */
export function idSuffixLost(oldName: string, newName: string): boolean {
  const before = fileIdSuffixOf(oldName);
  if (!before) return false;
  const after = parseFileIdSuffix(newName);
  return !after || after.id !== before.id || after.ext.toLowerCase() !== before.ext.toLowerCase();
}

/** The confirmation shown when renaming `oldName` to `newName` would lose its id (see idSuffixLost). */
export function idSuffixLossMessage(oldName: string, newName: string): string {
  return `Renaming "${oldName}" to "${newName}" removes or changes its link ID (the "--ID" part of the name) or its extension, so links to it will no longer repair themselves if it is moved or renamed. Rename anyway?`;
}
