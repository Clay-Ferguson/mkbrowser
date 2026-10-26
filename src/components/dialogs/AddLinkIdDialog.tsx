import { useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { BUTTON_CLASS_DLG_BLUE } from '../../renderer/styles';
import { getFileName } from '../../renderer/pathUtil';
import { addLinkTargetId } from '../../renderer/linkRepair';
import { addFileIdSuffixOp } from '../../renderer/fileOpsUtil';
import { isMarkdownFile } from '../../shared/fileTypes';
import { generateFileId, withFileIdSuffix } from '../../shared/fileIdSuffix';

interface AddLinkIdDialogProps {
  /** The file being linked to, which has no id yet. */
  targetPath: string;
  /**
   * Called once a choice is made or the dialog is dismissed (✕ or Esc); the parent should
   * unmount the dialog. A choice then goes on to `onLink`; a dismissal makes no link.
   */
  onClose: () => void;
  /**
   * Called after `onClose` with what to link to: `id` is the front-matter id to put in a
   * Markdown file's link title — the newly added one after "Add ID & Link" ('' if adding it
   * failed), or '' for "Plain Link" and for any other file. `targetPath` is where the file
   * now is: a non-Markdown file is renamed by "Add ID & Link" to carry its id.
   */
  onLink: (id: string, targetPath: string) => void;
}

/**
 * Asks whether to give a link's target an id before linking to it (see
 * resolveLinkTargetId) — an id is never added silently: a Markdown file gets an injected
 * front-matter block, visible to anyone reading the file, and any other file is renamed
 * to carry the id in its name (`report--3D6B20DDF.pdf`). Used by the editor's "Paste Link".
 */
function AddLinkIdDialog({ targetPath, onClose, onLink }: AddLinkIdDialogProps) {
  // A file-name id is chosen up front so the message can show the exact new name.
  const [fileId] = useState(generateFileId);
  const fileName = getFileName(targetPath);
  const isMarkdown = isMarkdownFile(fileName);

  return (
    <ConfirmDialog
      title={isMarkdown ? 'Add ID to Linked File?' : 'Add ID to File Name?'}
      message={isMarkdown
        ? `"${fileName}" has no ID. Adding one writes an "id" property into the file's 'front matter', and lets this link repair itself if the file is later renamed or moved.`
        : `"${fileName}" has no ID. Adding one renames it to "${withFileIdSuffix(fileName, fileId)}", and lets this link repair itself if the file is later renamed or moved (as long as the "--${fileId}" part and the extension are kept). Existing links to the old name will not be updated.`}
      confirmLabel="Add ID & Link"
      cancelLabel="Plain Link"
      confirmClassName={BUTTON_CLASS_DLG_BLUE}
      onConfirm={() => {
        onClose();
        if (isMarkdown) void addLinkTargetId(targetPath).then((id) => onLink(id, targetPath));
        else void addFileIdSuffixOp(targetPath, fileId).then((newPath) => onLink('', newPath));
      }}
      onCancel={() => {
        onClose();
        onLink('', targetPath);
      }}
      onDismiss={onClose}
    />
  );
}

export default AddLinkIdDialog;
