import ConfirmDialog from './ConfirmDialog';
import { BUTTON_CLASS_DLG_BLUE } from '../../renderer/styles';
import { getFileName } from '../../renderer/pathUtil';
import { addLinkTargetId } from '../../renderer/linkRepair';

interface AddLinkIdDialogProps {
  /** The Markdown file being linked to, which has no front-matter id yet. */
  targetPath: string;
  /**
   * Called once a choice is made or the dialog is dismissed (✕ or Esc); the parent should
   * unmount the dialog. A choice then goes on to `onLink`; a dismissal makes no link.
   */
  onClose: () => void;
  /**
   * Called after `onClose` with the id to put in the link title: the newly added one after
   * "Add ID & Link" ('' if adding it failed), or '' for "Plain Link".
   */
  onLink: (id: string) => void;
}

/**
 * Asks whether to add a front-matter id to a link's target before linking to it (see
 * resolveLinkTargetId) — an id is never added silently, since an injected front-matter
 * block is visible to anyone reading the file. Used by the editor's "Paste Link" and the
 * index tree's "Paste Link into Editor".
 */
function AddLinkIdDialog({ targetPath, onClose, onLink }: AddLinkIdDialogProps) {
  return (
    <ConfirmDialog
      title="Add ID to Linked File?"
      message={`"${getFileName(targetPath)}" has no ID. Adding one writes an "id" property into the file's 'front matter', and lets this link repair itself if the file is later renamed or moved.`}
      confirmLabel="Add ID & Link"
      cancelLabel="Plain Link"
      confirmClassName={BUTTON_CLASS_DLG_BLUE}
      onConfirm={() => {
        onClose();
        void addLinkTargetId(targetPath).then(onLink);
      }}
      onCancel={() => {
        onClose();
        onLink('');
      }}
      onDismiss={onClose}
    />
  );
}

export default AddLinkIdDialog;
