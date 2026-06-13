import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_RED, DLG_FOOTER_CLASS } from '../../utils/styles';

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog title="Confirm" onClose={onCancel} className="max-w-md">
      <div className="p-6">
        <p className="text-slate-200 mb-6">{message}</p>
        <div className={DLG_FOOTER_CLASS}>
          <button
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
