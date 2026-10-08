/**
 * True when a keypress belongs to an open overlay — a native <dialog> (Dialog.tsx)
 * or a popover PopupMenu — rather than to whatever document-level listener is
 * asking. Checks both where the key landed and whether any overlay is open, since
 * focus is not always inside the overlay (e.g. a menu opened while the editor
 * keeps focus).
 *
 * Every app dialog is a native <dialog> opened with showModal(), so this needs no
 * cooperation from the dialogs themselves: a document 'keydown' listener just
 * returns early when this is true.
 */
export function isKeyForOverlay(e: KeyboardEvent): boolean {
  if (e.target instanceof Element && e.target.closest('dialog,[popover]')) return true;
  return document.querySelector('dialog[open],[popover]:popover-open') !== null;
}
