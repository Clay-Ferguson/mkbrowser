import { useLayoutEffect } from 'react';
import { useAS, clearPendingScrollToFile } from '../../store';
import { scrollItemIntoView } from '../../renderer/entryDom';

/**
 * Consumes `pendingScrollToFile` — the store request that says "show the folder
 * listing, scrolled to this file" — *before the browser paints*.
 *
 * ## Why a layout effect
 *
 * Every route into the listing that targets a specific file (search result,
 * index tree, calendar, folder graph, a markdown link, the up button, leaving
 * an expanded edit, creating/pasting a file, the image viewer's J-jump) sets
 * this flag rather than scrolling directly, because the target element does not
 * exist yet: the destination folder still has to load, and its entries render
 * on React's schedule.
 *
 * This used to be handled by a passive `useEffect` with a 100ms settle timeout.
 * A passive effect runs *after* the browser has painted, so the sequence was
 * always: paint the new entries at the old (or zero) scroll offset → scroll →
 * paint again. The user saw the page jump — a flicker that no amount of timer
 * tuning removes, because the first of those two frames is the bug.
 *
 * `useLayoutEffect` runs synchronously after the DOM is mutated and *before*
 * the browser paints that commit, so scrolling here means the first frame the
 * user ever sees is already at the final position. There is no intermediate
 * frame to flicker.
 *
 * ## Why there is no dependency array
 *
 * The commit that matters is the one that first renders the target element, and
 * we cannot know in advance which commit that is (it depends on when the folder
 * load resolves). So this runs after *every* commit of the calling component
 * and asks the DOM: is the target here yet? That makes it self-correcting by
 * construction rather than by timing — the antithesis of a fragile
 * "hopefully 100ms is enough" delay. The check is a single `getElementById`
 * guarded by a null flag, so idle renders cost nothing.
 *
 * The flag is consumed only once the element is actually found and scrolled
 * (`scrollItemIntoView` reports this), so a commit that fires before the
 * destination folder's entries land does not throw the request away. A request
 * naming a file that never renders simply stays pending and is superseded by
 * the next one — callers that could produce such a path guard against it (see
 * BrowseFile's `handleBrowseFolder`).
 *
 * ## Drift after the commit
 *
 * A layout effect only fires for commits of the component that owns it, and a
 * *child* entry finishing its own async content load is not one of those. Such
 * late content reflows the page above the target and would slide it back out of
 * view, so the scroll is followed by the settle phase in `entryDom` (instant
 * corrections, self-cancelling on any user scroll input) which keeps the target
 * pinned for a couple of seconds.
 *
 * ## Where to call it
 *
 * From the view that renders the entries themselves (BrowseView), not from an
 * ancestor: layout effects fire bottom-up for the components that re-rendered,
 * and the whole point is to be on the commit where the entry rows appear.
 */
export function usePendingItemScroll(): void {
  const pendingScrollToFile = useAS(s => s.pendingScrollToFile);
  const currentView = useAS(s => s.currentView);

  // Intentionally no dependency array — see the doc comment above.
  useLayoutEffect(() => {
    if (!pendingScrollToFile) return;
    // Other tabs stay mounted (display:none) and manage their own scrolling;
    // measuring or scrolling a hidden pane would produce nonsense. The request
    // stays pending and is picked up on the commit that shows this view.
    if (currentView !== 'browser') return;

    if (scrollItemIntoView(pendingScrollToFile, false, true)) {
      clearPendingScrollToFile();
    }
  });
}
