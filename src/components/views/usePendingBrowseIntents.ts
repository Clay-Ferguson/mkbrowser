import { useEffect, useRef, type RefObject, type UIEvent } from 'react';
import {
  useAS,
  useIsActiveView,
  setItemEditing,
  setItemExpanded,
  clearPendingEditFile,
  clearPendingExpandFile,
  clearPendingScrollToHeadingSlug,
  setBrowserScrollPosition,
  getBrowserScrollPosition,
} from '../../store';
import { holdScrollTop, scrollElementIntoView } from '../../renderer/entryDom';
import { getParentPath } from '../../renderer/pathUtil';
import { affectsBrowseListing } from '../../renderer/dragAndDrop';
import { usePendingItemScroll } from './usePendingItemScroll';

/**
 * BrowseView's scroll position and pending-intent handling for the listing in
 * `mainContainerRef`:
 *
 * - saves the scroll position per folder (debounced, via the returned
 *   `handleMainScroll`, which the container's `onScroll` must call) and
 *   restores it on folder navigation and on remount;
 * - consumes the store's pending requests once the directory has loaded:
 *   `pendingScrollToFile` (pre-paint, via {@link usePendingItemScroll}),
 *   `pendingScrollToHeadingSlug`, `pendingEditFile` and `pendingExpandFile`.
 *
 * One hook rather than two because the restore and the pending scrolls gate
 * each other: a restore would fight a pending file/heading scroll that has not
 * landed yet.
 */
export function usePendingBrowseIntents(mainContainerRef: RefObject<HTMLElement | null>) {
  const isActive = useIsActiveView('browser');
  const currentPath = useAS(s => s.currentPath);
  const loading = useAS(s => s.entriesLoading);
  const pendingScrollToFile = useAS(s => s.pendingScrollToFile);
  const pendingScrollToHeadingSlug = useAS(s => s.pendingScrollToHeadingSlug);
  const pendingEditFile = useAS(s => s.pendingEditFile);
  const pendingEditView = useAS(s => s.pendingEditView);
  const pendingExpandFile = useAS(s => s.pendingExpandFile);

  const previousPathRef = useRef<string | null>(null);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Consumes pendingScrollToFile before the browser paints the commit that
  // renders the target entry, so the listing never appears at the wrong scroll
  // offset first. Everything else that has to wait for the DOM (the heading
  // scroll, the per-folder position restore, pending edit/expand) stays in the
  // passive effect below, where a frame of delay is invisible anyway.
  usePendingItemScroll();

  // Restore scroll position on folder navigation, and handle the remaining
  // pending requests once the directory has loaded
  useEffect(() => {
    if (loading) return;

    // Skip browser scroll handling when not in browser view — ThreadView
    // manages its own scrolling and we don't want to interfere.
    if (!isActive) {
      // Keep the tracked folder in sync so returning to this tab isn't mistaken
      // for a folder navigation (which would save a scrollTop belonging to a
      // listing that is no longer rendered). Deliberately leaves a null ref
      // null: this component can mount while another tab is active, and that
      // mount still owes a scroll restore — see isFirstMount below.
      if (previousPathRef.current !== null) previousPathRef.current = currentPath;
      return;
    }

    // Detect folder navigation within the browser tab. BrowseView stays
    // mounted across tab switches (visibility is toggled via CSS), so its
    // scroll position is preserved natively when switching tabs — we only
    // need to save/restore per folder when navigating between folders.
    const isNewFolder = previousPathRef.current !== null && previousPathRef.current !== currentPath;

    // A fresh mount also has to restore, because this component really does get
    // unmounted and remounted: single-file mode (browsing one file, and
    // expanded editing) swaps it out for BrowseFile rather than hiding it. The
    // position was last written by the debounced scroll save, so it comes back
    // accurate to within 150ms. At app startup nothing is saved yet and the
    // restore is a harmless scrollTo(0).
    const isFirstMount = previousPathRef.current === null;

    // Save scroll position for the previous folder before switching
    if (isNewFolder && previousPathRef.current && mainContainerRef.current) {
      setBrowserScrollPosition(previousPathRef.current, mainContainerRef.current.scrollTop);
    }

    previousPathRef.current = currentPath;

    // Nothing here consumes pendingScrollToFile: that request is handled
    // pre-paint by usePendingItemScroll (a layout effect), which is what keeps
    // the listing from ever painting at the wrong offset. It is still read here
    // as a gate, because both branches below would fight a scroll that has not
    // landed yet — and consuming it re-runs this effect, so neither branch is
    // missed.
    if (!pendingScrollToFile) {
      if (pendingScrollToHeadingSlug) {
        // Set alongside pendingScrollToFile; reached once that file scroll has
        // succeeded and consumed its flag. Fire-and-forget: the scroller itself
        // polls for the heading to render (no fixed delay) and keeps it centered
        // while late-loading content reflows the page, self-cancelling on user
        // input / element removal / timeout — so it deliberately isn't tied to
        // this effect's cleanup, and the flag is consumed immediately.
        scrollElementIntoView(pendingScrollToHeadingSlug, true);
        clearPendingScrollToHeadingSlug();
      } else if (isNewFolder || isFirstMount) {
        // Restore the saved scroll position for the folder we navigated to (or
        // the one we were already in, when remounting). The entries' bodies are
        // typically still loading, so the listing may not yet be tall enough to
        // reach the saved offset; holdScrollTop re-applies it as they fill in.
        const mainContainer = mainContainerRef.current;
        if (mainContainer) {
          holdScrollTop(mainContainer, getBrowserScrollPosition(currentPath));
        }
      }
    }

    // Handle pending edit (e.g., from search results edit button, or a "New
    // File" from the index tree). The item only enters the store once the load
    // for its folder has finished, and this effect can fire before that when
    // the request came with a navigation to a *different* folder — so wait for
    // the item rather than consuming the request against a missing one (which
    // would silently drop the edit). Once the pending file's folder is one this
    // listing doesn't render it can never arrive, so drop it then — a test of
    // affectsBrowseListing rather than folder equality, because a newly created
    // attachment lives in a .attach folder below currentPath yet is rendered as
    // a row here. Store-only: expanding and editing are state changes the
    // entry renders from, so nothing here waits on the DOM.
    if (pendingEditFile && pendingEditView === 'browser') {
      if (useAS.getState().items.has(pendingEditFile)) {
        setItemExpanded(pendingEditFile, true);
        setItemEditing(pendingEditFile, true);
        clearPendingEditFile();
      } else if (!affectsBrowseListing(getParentPath(pendingEditFile), currentPath)) {
        clearPendingEditFile();
      }
    }

    // Handle pending expand (e.g., a file pasted from the clipboard). The item
    // only enters the store once the refresh that created it has loaded, so —
    // like the pending edit above — consume the request only when it's there,
    // and let a later run of this effect handle it otherwise.
    if (pendingExpandFile && useAS.getState().items.has(pendingExpandFile)) {
      setItemExpanded(pendingExpandFile, true);
      clearPendingExpandFile();
    }
  }, [loading, pendingScrollToFile, pendingScrollToHeadingSlug, pendingEditFile, pendingEditView, pendingExpandFile, currentPath, isActive, mainContainerRef]);

  // Clear any pending debounced save on unmount (full app teardown / closing
  // the folder). BrowseView no longer unmounts on tab switches, so there is no
  // view-switch scroll position to flush here.
  useEffect(() => {
    // Returns the useEffect cleanup (an unsubscribe-style teardown): clears the pending debounced scroll-save timeout on unmount.
    return () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current);
      }
    };
  }, []);

  // Handle scroll events on the main container (debounced save)
  const handleMainScroll = (e: UIEvent<HTMLElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    if (scrollSaveTimerRef.current) {
      clearTimeout(scrollSaveTimerRef.current);
    }
    scrollSaveTimerRef.current = setTimeout(() => {
      if (currentPath) {
        setBrowserScrollPosition(currentPath, scrollTop);
      }
    }, 150);
  };

  return handleMainScroll;
}
