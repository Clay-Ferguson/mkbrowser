import DlgHeader from './common/DlgHeader';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_RED, DLG_OVERLAY_CLASS, DLG_FOOTER_CLASS } from '../../utils/styles';

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    onConfirm();
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCancel();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  return (
    <div className={DLG_OVERLAY_CLASS} onClick={handleBackdropClick}>
      <div className="bg-slate-800 rounded-lg border-2 border-slate-400 max-w-md mx-4 shadow-xl overflow-hidden">
        <DlgHeader title="Confirm" onClose={onCancel} />
        <div className="p-6">
        <p className="text-slate-200 mb-6">{message}</p>
        <div className={DLG_FOOTER_CLASS}>
          <button
            onClick={handleCancel}
            className={BUTTON_CLASS_DLG_CANCEL}
            data-testid="confirm-dialog-cancel-button"
          >
            No
          </button>
          <button
            onClick={handleConfirm}
            className={BUTTON_CLASS_DLG_RED}
            data-testid="confirm-dialog-confirm-button"
          >
            Yes
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
