import type { AppState } from '../shared/types';
import { getParentPath, getFileName, isSamePath } from '../renderer/pathUtil';

// ============================================================================
// Expanded-editor routing rules.
//
// A maximized editor lives in exactly one place: BrowseFile, the single-file
// view. So "the user's `expandedEditor` preference is on and they started an
// edit in the folder listing" is implemented by *entering single-file mode*
// (browseFileName + browseFileMode: 'expanded-edit'), not by re-styling the
// listing around the entry being edited. BrowseView therefore only ever renders
// a folder listing.
//
// These are pure predicates over a state snapshot rather than store actions:
// both `setItemEditing` (items.ts) and `toggleExpandedEditor` (view.ts) fold
// their result into their own single `set()` call, keeping the multi-field
// patch atomic as AGENTS.md requires. Living in their own module also keeps the
// items ↔ view slice imports acyclic.
// ============================================================================

/**
 * The patch that hands `path` the whole pane for a maximized edit, or null when
 * this edit should stay inline in the folder listing.
 *
 * The three context checks are what scope this precisely to the folder listing:
 *
 * - `currentView === 'browser'` excludes ThreadView, which renders its entries
 *   in a scrolling block and ignores expanded editing in practice.
 * - `getParentPath(path) === currentPath` excludes attachments: files inside a
 *   `*_attach` folder are rendered by `AttachFolderContents` from a *different*
 *   folder, so they keep editing inline (a deliberate simplification).
 * - `browseFileName === null` means we are not already in single-file mode.
 *   Editing a file reached by 'browse' must leave its mode alone — that caller
 *   owns the pane on its own terms and hides the expand/collapse toggle.
 *
 * Note this deliberately does NOT scan the items map for "something is
 * editing". Such a scan is what produced the bug this design removes: the map
 * is global and long-lived, so it stays true after navigating away from the
 * file being edited.
 */
export function enterExpandedEditPatch(state: AppState, path: string): Partial<AppState> | null {
  if (!state.settings.expandedEditor) return null;
  if (state.currentView !== 'browser') return null;
  if (state.browseFileName !== null) return null;
  if (!isSamePath(getParentPath(path), state.currentPath)) return null;
  return { browseFileName: getFileName(path), browseFileMode: 'expanded-edit' };
}

/** True while the pane is given over to a maximized edit of any file. */
export function isExpandedEditing(state: AppState): boolean {
  return state.browseFileName !== null && state.browseFileMode === 'expanded-edit';
}

/**
 * True while the pane is given over to a maximized edit of `path` specifically.
 * Used to decide whether an edit *ending* should drop back to the listing: an
 * unrelated file leaving edit mode (a stale `editing: true` from another folder
 * closed by the global Escape handler) must not evict the file on screen.
 */
export function isExpandedEditOf(state: AppState, path: string): boolean {
  return isExpandedEditing(state)
    && state.browseFileName === getFileName(path)
    && isSamePath(getParentPath(path), state.currentPath);
}
