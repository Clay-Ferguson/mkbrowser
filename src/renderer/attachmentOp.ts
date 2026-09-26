/**
 * The per-file attachment workflows behind the entry menus in BrowseView's
 * listing. A file's attachments live in its sibling `<file>.attach` folder,
 * which each of these creates on demand.
 *
 * Each is a fire-and-forget workflow for a user action (`void`, run through
 * {@link runOp}), so a component only wires a menu item to it: failures reach
 * the app-wide error dialog.
 */

import { api } from './api';
import { runOp } from './runOp';
import { ensureAttachFolder, createAttachmentFileOp, pasteIntoFolder, pasteFromClipboardOp } from './fileOpsUtil';
import { canDropAsAttachment, dropAsAttachment } from './dragAndDrop';
import { getFileName, joinPath } from './pathUtil';
import { ATTACH_SUFFIX } from '../shared/specialFiles';
import { setAppError, setPendingExpandFile, setPendingScrollToFile, useAS } from '../store';

/** Moves the cut items into `filePath`'s attach folder. */
export function pasteCutAsAttachment(filePath: string): void {
  runOp(async () => {
    const attachFolderPath = await ensureAttachFolder(filePath);
    if (!attachFolderPath) return;
    await pasteIntoFolder(attachFolderPath, useAS.getState().items);
  }, 'Failed to paste as attachment: ');
}

/** Saves the system clipboard's contents as a new file in `filePath`'s attach folder. */
export function pasteClipboardAsAttachment(filePath: string): void {
  runOp(async () => {
    const attachFolderPath = await ensureAttachFolder(filePath);
    if (!attachFolderPath) return;
    await pasteFromClipboardOp(attachFolderPath);
  }, 'Failed to paste as attachment: ');
}

/**
 * Moves (not copies) a file chosen with the OS picker into `filePath`'s attach
 * folder, via the same path as a drag-and-drop attach. The picker runs first,
 * so cancelling never leaves an empty .attach folder behind.
 */
export function attachFromFile(filePath: string): void {
  runOp(async () => {
    const sourcePath = await api.selectFile('Select a file to attach');
    if (!sourcePath) return;
    const payload = { path: sourcePath, name: getFileName(sourcePath), isDirectory: false };
    if (!canDropAsAttachment(payload, filePath)) {
      setAppError('That file cannot be attached here: it is this file itself, or is already attached to it.');
      return;
    }
    const moved = await dropAsAttachment(payload, filePath);
    if (!moved) return; // dropAsAttachment already reported the failure
    const newPath = joinPath(`${filePath}${ATTACH_SUFFIX}`, payload.name);
    setPendingScrollToFile(newPath);
    setPendingExpandFile(newPath);
  }, 'Failed to attach file: ');
}

/**
 * Creates a brand-new empty Markdown attachment and puts the user straight into
 * editing it — the from-scratch counterpart to {@link attachFromFile}'s "attach
 * a file that already exists". No dialog: the file is timestamp-named like any
 * inserted new file, and the user renames it afterwards if they want to.
 */
export function createAttachment(filePath: string): void {
  runOp(async () => {
    await createAttachmentFileOp(filePath);
  }, 'Failed to create attachment: ');
}
