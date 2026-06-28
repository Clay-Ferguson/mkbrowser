import { useRef } from 'react';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_RED, DLG_FOOTER_CLASS } from '../../renderer/styles';

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  // Focus the safe action ("No") on open so an accidental Enter doesn't trigger
  // the destructive "Yes". The dialog has no form fields, so without this focus
  // would land on the header ✕.
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog title="Confirm" onClose={onCancel} className="max-w-md" initialFocusRef={cancelButtonRef}>
      <div className="p-6">
        <p className="text-slate-200 mb-6">{message}</p>
        <div className={DLG_FOOTER_CLASS}>
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
            data-testid="confirm-dialog-cancel-button"
          >
            No
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={BUTTON_CLASS_DLG_RED}
            data-testid="confirm-dialog-confirm-button"
          >
            Yes
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export default ConfirmDialog;
