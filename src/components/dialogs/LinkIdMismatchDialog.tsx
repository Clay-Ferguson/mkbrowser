import { useRef } from 'react';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_BLUE, BUTTON_CLASS_DLG_CANCEL, DLG_FOOTER_CLASS } from '../../renderer/styles';
import { getFileName } from '../../renderer/pathUtil';
import type { LinkIdMismatch } from '../../store';

interface LinkIdMismatchDialogProps {
  mismatch: LinkIdMismatch;
  /** Opens `mismatch.otherPath` (only offered when it was found). */
  onOpenOther: () => void;
  onClose: () => void;
}

/**
 * Warns that a clicked Markdown link titled `"id:…"` opened a file whose front-matter
 * id doesn't match the link's, so the user may be viewing a different file than the
 * one the link was made for. When the file that does carry the link's id was found,
 * it is named and can be opened from here.
 */
function LinkIdMismatchDialog({ mismatch, onOpenOther, onClose }: LinkIdMismatchDialogProps) {
  const { linkId, openedPath, openedId, otherPath } = mismatch;
  // Focus the primary action: opening the file the link was made for, when known.
  const primaryRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog title="Link May Point to the Wrong File" onClose={onClose} className="max-w-lg" initialFocusRef={primaryRef} testId="link-id-mismatch-dialog">
      <div className="p-6 text-slate-200 space-y-3">
        <p>
          The link you clicked was made for the file with id <code className="text-amber-300">{linkId}</code>,
          but the file it opened, <span className="font-semibold">{getFileName(openedPath)}</span>,{' '}
          {openedId
            ? <>has id <code className="text-amber-300">{openedId}</code>.</>
            : <>has no id.</>}
          {' '}You may be viewing a different file than the one originally linked.
        </p>
        {otherPath ? (
          <>
            <p>The file with id <code className="text-amber-300">{linkId}</code> is:</p>
            <p className="font-mono text-sm break-all bg-slate-900 rounded px-3 py-2">{otherPath}</p>
          </>
        ) : (
          <p>No file with id <code className="text-amber-300">{linkId}</code> was found in this folder tree.</p>
        )}
        <div className={`${DLG_FOOTER_CLASS} pt-3`}>
          {otherPath ? (
            <>
              <button type="button" onClick={onClose} className={BUTTON_CLASS_DLG_CANCEL} data-testid="link-id-mismatch-close-button">
                Close
              </button>
              <button ref={primaryRef} type="button" onClick={onOpenOther} className={BUTTON_CLASS_DLG_BLUE} data-testid="link-id-mismatch-open-button">
                Open Linked File
              </button>
            </>
          ) : (
            <button ref={primaryRef} type="button" onClick={onClose} className={BUTTON_CLASS_DLG_BLUE} data-testid="link-id-mismatch-close-button">
              OK
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export default LinkIdMismatchDialog;
