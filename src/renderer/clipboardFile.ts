/**
 * The file on the clipboard, as offered by the editor's "Create & Paste File": a file
 * copied in the OS file manager, or image bytes (a screenshot, a browser's "Copy Image").
 *
 * See: (USER_GUIDE.md#inserting-links-to-other-files)
 */
import { api } from './api';
import { generateTimestampFilename, imageExtForMime } from './clipboard';
import { getFileName } from './pathUtil';
import { logger } from '../shared/logUtil';
import { stripFileIdSuffix } from '../shared/fileIdSuffix';

export type ClipboardFile =
  /** A file copied in the OS file manager, to be copied as-is. */
  | { kind: 'path'; sourcePath: string }
  /** Image bytes, to be written out with `ext` (`.png`, …). */
  | { kind: 'image'; blob: Blob; ext: string };

/** The first image item on the clipboard, or null (including when it can't be read). */
async function findClipboardImage(): Promise<ClipboardFile | null> {
  if (typeof navigator.clipboard?.read !== 'function') return null;
  let items: ClipboardItem[];
  try {
    items = await navigator.clipboard.read();
  } catch (err) {
    logger.warn('Failed to read clipboard items:', err);
    return null;
  }
  for (const item of items) {
    const imageType = item.types.find(type => type.startsWith('image/'));
    if (imageType) {
      const blob = await item.getType(imageType).catch(() => null);
      if (blob) return { kind: 'image', blob, ext: imageExtForMime(imageType) };
    }
  }
  return null;
}

/**
 * Resolves to the file on the clipboard, or null when there is none. A file copied in the
 * file manager wins over image bytes, since it keeps the real file's bytes, format and
 * name; when several files were copied only the first is used. Never rejects.
 */
export async function findClipboardFile(): Promise<ClipboardFile | null> {
  const paths = await api.readClipboardFilePaths().catch(() => [] as string[]);
  const sourcePath = paths[0];
  if (sourcePath) return { kind: 'path', sourcePath };
  return findClipboardImage();
}

/** The extension (with its dot) the pasted file is expected to have, or '' when it has none. */
export function clipboardFileExt(file: ClipboardFile): string {
  if (file.kind === 'image') return file.ext;
  const name = getFileName(file.sourcePath);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

/**
 * The name "Create & Paste File" starts from: a copied file's own name, minus any `--ID` it
 * carries (the copy gets a fresh one), used as-is; or just the extension for image bytes,
 * which have no name — the name dialog then starts with it, and the user types the rest
 * in front of it.
 */
export function defaultPastedFileName(file: ClipboardFile): string {
  return file.kind === 'path' ? stripFileIdSuffix(getFileName(file.sourcePath)) : file.ext;
}

/**
 * The file name to create from the dialog's raw input: trimmed, or a timestamp name with
 * `ext` when the input is blank or is just `ext` (`.png`: no name was typed in front of
 * it). Otherwise the name is kept as typed — the suggested extension is only a
 * suggestion. Pure, for testability.
 */
export function normalizePastedFileName(raw: string, ext: string): string {
  const name = raw.trim();
  if (!name || name === ext) return generateTimestampFilename(ext);
  return name;
}
