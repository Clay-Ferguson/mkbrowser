import { useRef } from 'react';
import Dialog from './common/Dialog';
import { BUTTON_CLASS_DLG_CANCEL, BUTTON_CLASS_DLG_RED, DLG_FOOTER_CLASS } from '../../renderer/styles';

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Dialog title. Default "Confirm". */
  title?: string;
  /** Label of the confirm button. Default "Yes". */
  confirmLabel?: string;
  /** Label of the cancel button. Default "No". */
  cancelLabel?: string;
  /** Button class of the confirm button. Default BUTTON_CLASS_DLG_RED (destructive). */
  confirmClassName?: string;
  /**
   * Called when the dialog is dismissed with the header ✕ or Esc. Defaults to
   * `onCancel`; pass it when the cancel button is itself an action (e.g. "Plain
   * Link") so that dismissing can abort without taking either choice.
   */
  onDismiss?: () => void;
}

/**
 * Generic yes/no confirmation dialog, used wherever an action needs the user to
 * confirm (typically a destructive one). By default "Yes" is styled as the
 * destructive (red) action and "No" as the safe default; see the focus note below
 * for why the cancel button receives initial focus. The optional props relabel and
 * restyle it for a non-destructive two-way choice.
 */
function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
  title = 'Confirm',
  confirmLabel = 'Yes',
  cancelLabel = 'No',
  confirmClassName = BUTTON_CLASS_DLG_RED,
  onDismiss,
}: ConfirmDialogProps) {
  // Focus the safe action ("No") on open so an accidental Enter doesn't trigger
  // the destructive "Yes". The dialog has no form fields, so without this focus
  // would land on the header ✕.
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog title={title} onClose={onDismiss ?? onCancel} className="max-w-md" initialFocusRef={cancelButtonRef}>
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
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={confirmClassName}
            data-testid="confirm-dialog-confirm-button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export default ConfirmDialog;
