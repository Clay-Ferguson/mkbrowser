import { clipboard } from 'electron';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from '../shared/logUtil';

/**
 * Reads the paths of files copied in the OS file manager (Nautilus, Dolphin, Explorer,
 * Finder…), for the editor's "Create & Paste File". Chromium's `navigator.clipboard` only
 * exposes text and image bytes to the renderer, so this has to go through Electron's
 * main-process clipboard, whose format names differ per platform.
 *
 * See: (USER_GUIDE.md#inserting-links-to-other-files)
 */

/**
 * The local paths named by a `text/uri-list` (or GNOME's `x-special/gnome-copied-files`,
 * which is the same list after a `copy`/`cut` header line). Comment lines (`#…`), the
 * header, blank lines and non-`file:` URIs are skipped. Pure, for testability.
 */
export function parseFileUriList(text: string): string[] {
  const paths: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\0/g, '').trim();
    if (!line.startsWith('file://')) continue;
    try {
      paths.push(fileURLToPath(line));
    } catch {
      // Not a local file URL (e.g. file://host/...) — skip it.
    }
  }
  return paths;
}

/** The raw copied-file paths on the clipboard, in the current platform's format. */
function readRawClipboardPaths(): string[] {
  if (process.platform === 'win32') {
    // A single UTF-16LE path, NUL-terminated.
    const path = clipboard.readBuffer('FileNameW').toString('utf16le').replace(/\0+$/, '').trim();
    return path ? [path] : [];
  }
  if (process.platform === 'darwin') {
    return parseFileUriList(clipboard.read('public.file-url'));
  }
  const uriList = parseFileUriList(clipboard.read('text/uri-list'));
  if (uriList.length > 0) return uriList;
  return parseFileUriList(clipboard.readBuffer('x-special/gnome-copied-files').toString('utf8'));
}

/**
 * Resolves to the paths of the regular files copied to the clipboard in the OS file
 * manager, in clipboard order — empty when there are none (folders are left out). Never
 * rejects.
 */
export async function readClipboardFilePaths(): Promise<string[]> {
  let candidates: string[];
  try {
    candidates = readRawClipboardPaths();
  } catch (err) {
    logger.warn('Failed to read copied files from the clipboard:', err);
    return [];
  }
  const files: string[] = [];
  for (const candidate of candidates) {
    const stat = await fs.promises.stat(candidate).catch(() => null);
    if (stat?.isFile()) files.push(candidate);
  }
  return files;
}
