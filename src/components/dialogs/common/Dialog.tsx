import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import DlgHeader from './DlgHeader';
import { DLG_CONTAINER } from '../../../renderer/styles';

interface DialogProps {
  /** Title shown in the DlgHeader; also wired to the dialog via aria-labelledby. */
  title: string;
  /** Called when the dialog is dismissed (header ✕, Esc, or backdrop click if enabled). */
  onClose: () => void;
  children: ReactNode;
  /**
   * Sizing/layout classes for the dialog box itself, e.g. `w-full max-w-md` or
   * `flex flex-col w-full max-w-4xl`. The base chrome (background, border, rounded
   * corners) comes from DLG_CONTAINER; this is appended on top.
   */
  className?: string;
  /** When true, clicking the backdrop dismisses the dialog. Default false (safer for editors). */
  closeOnBackdrop?: boolean;
  /** data-testid applied to the underlying <dialog> element. */
  testId?: string;
  /**
   * Element to focus (and select, if it's a text field) on open, instead of the
   * default first editable field. Use when the field that should receive focus
   * isn't the first one (e.g. focusing File Name when Output Folder comes first).
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

// First editable form field, excluding non-text inputs and disabled controls.
const FIRST_FIELD_SELECTOR =
  'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([disabled]), textarea:not([disabled]), select:not([disabled])';

/**
 * Shared modal wrapper built on the native HTML <dialog> element.
 *
 * Opening with `showModal()` gives us, for free and to spec:
 *   - the WAI-ARIA modal dialog semantics (implicit role="dialog" + aria-modal),
 *   - a focus trap that keeps Tab inside the dialog,
 *   - focus restoration to the previously-focused element on close,
 *   - Esc-to-dismiss (surfaced here through the `cancel` event),
 *   - rendering in the browser's top layer, which sits above all page content
 *     regardless of z-index/overflow/transform — so no portal is needed and the
 *     CodeMirror stacking concerns noted in styles.ts don't apply here.
 *
 * Autofocus: `showModal()` would otherwise focus the first focusable element,
 * which is the header ✕ button. Instead we focus the first editable field
 * (input/textarea/select) on open so the user can start typing immediately, and
 * select any prefilled text so it can be overwritten in one keystroke (a no-op
 * for empty fields). This replaces the old
 * useEffect(() => { ref.current?.focus(); ref.current?.select(); }) pattern.
 * Pass `initialFocusRef` to focus a specific element instead of the first field.
 */
function Dialog({
  title,
  onClose,
  children,
  className = '',
  closeOnBackdrop = false,
  testId,
  initialFocusRef,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Snapshot the initial-focus target at mount. The dialog opens exactly once (in
  // the mount-only effect below), so the focus target only needs reading once —
  // and keeping initialFocusRef out of that effect's deps prevents a parent that
  // swaps the ref object across renders from triggering a close()/showModal()
  // flicker (plus refocus/reselect churn) on the already-open dialog.
  const initialFocusSnapshotRef = useRef(initialFocusRef);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (dlg && !dlg.open) {
      dlg.showModal();
      // Move focus off the header ✕ button (showModal's default) onto an
      // explicit target if given, else the first editable field — selecting any
      // prefilled text so it can be typed over.
      const field = initialFocusSnapshotRef.current?.current ?? dlg.querySelector<HTMLElement>(FIRST_FIELD_SELECTOR);
      field?.focus();
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        field.select();
      }
    }
    // Close the native dialog on unmount so the element leaves the top layer
    // even if the parent removes us without an onClose round-trip.
    // Returns the useEffect cleanup (an unsubscribe-style teardown): closes the native <dialog> on unmount so it leaves the top layer.
    return () => {
      if (dlg?.open) dlg.close();
    };
  }, []);

  // The native `cancel` event fires on Esc (and other platform dismiss gestures).
  // We drive open/closed from React state in the parent, so prevent the element
  // from closing itself and route the intent through onClose instead.
  const handleCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };

  const handleClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    // The dialog is rendered inline in the React tree of whatever opened it,
    // which is often a clickable row (e.g. a FolderEntry header that navigates
    // on click). Synthetic events bubble through the React tree regardless of
    // the native <dialog>'s top-layer placement, so stop clicks here to keep
    // them from leaking out to those ancestors (which would, e.g., navigate
    // away mid-save or re-open a just-deleted folder).
    e.stopPropagation();
    if (!closeOnBackdrop) return;
    // The backdrop is part of the <dialog> element, so a click whose target is
    // the element itself (not an inner child) landed outside the content box.
    if (e.target === dialogRef.current) onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-testid={testId}
      onCancel={handleCancel}
      onClick={handleClick}
      className={`${DLG_CONTAINER} m-auto p-0 overflow-hidden text-slate-200 backdrop:bg-black/50 ${className}`}
    >
      <DlgHeader title={title} titleId={titleId} onClose={onClose} />
      {children}
    </dialog>
  );
}

export default Dialog;
