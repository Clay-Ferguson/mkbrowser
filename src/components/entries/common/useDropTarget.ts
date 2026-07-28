import { useState } from 'react';
import type React from 'react';
import { ENTRY_DND_MIME, parseDragPayload, type DragPayload } from '../../../renderer/dragAndDrop';

/** What {@link useDropTarget} returns: the highlight flag plus the props to spread on the row. */
export interface DropTargetState {
  /** True while an acceptable drag is hovering the row — apply ENTRY_DROP_TARGET. */
  isDragOver: boolean;
  /** Spread onto the element that should receive drops. */
  dropProps: {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

/**
 * Makes a single row a drop target for entries dragged from the browse view or the index
 * tree, owning the drag-over highlight state so each entry component doesn't hand-roll it.
 *
 * For multi-row targets that track one shared "which row is hovered" path (IndexTreeView,
 * PathBreadcrumb) this hook does not fit — those keep their own state and call
 * `completeEntryDrop` directly.
 *
 * @param accepts - Whether this row will take the payload (e.g. `canDropInto` /
 *   `canDropAsAttachment`). Called on drop; a rejected payload is silently ignored.
 * @param onDropPayload - Performs the drop. Fire-and-forget: the DataTransfer has already
 *   been read by the time this runs.
 */
export function useDropTarget(
  accepts: (payload: DragPayload) => boolean,
  onDropPayload: (payload: DragPayload) => void
): DropTargetState {
  const [isDragOver, setIsDragOver] = useState(false);

  const onDragOver = (e: React.DragEvent) => {
    // Ignore drags carrying anything else (notably OS file drags), leaving the
    // event unhandled so the row shows no drop affordance for them.
    if (!e.dataTransfer.types.includes(ENTRY_DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!isDragOver) setIsDragOver(true);
  };

  const onDragLeave = () => setIsDragOver(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    // Stop the drop here: rows can be nested (an attachment sits inside its
    // folder's row), and only the innermost target should act on it.
    e.stopPropagation();
    setIsDragOver(false);

    // Read the drag payload synchronously — the DataTransfer is only valid
    // during the event dispatch, before any await.
    const payload = parseDragPayload(e.dataTransfer.getData(ENTRY_DND_MIME));
    if (!payload || !accepts(payload)) return;

    onDropPayload(payload);
  };

  return { isDragOver, dropProps: { onDragOver, onDragLeave, onDrop } };
}
