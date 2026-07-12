/**
 * Kill switch for the dynamic "settle" phase of scrollElementIntoView (the
 * ResizeObserver that keeps the target centered while late-loading content —
 * mermaid, KaTeX, images without pre-reserved dimensions — reflows the page,
 * plus its cancel-on-user-input listeners). Set to false to fall back to a
 * simpler scroll that is still acceptable in practice: wait for the target
 * element to render, give late content a fixed grace period
 * (ONE_SHOT_SCROLL_DELAY_MS), then scroll to it once with no follow-up
 * corrections — i.e. the app's behavior before the settle logic was added.
 */
const DYNAMIC_SCROLL_TO_ELEMENT = true;

// Brighter purple for dark backgrounds
const HIGHLIGHT_BOX_SHADOW = '0 0 0 2px #c084fc'; // Tailwind purple-400

/**
 * Adds a temporary highlight to a DOM element (2px bright purple border).
 * Removes the highlight after a few seconds.
 */
export function temporaryHighlightItem(element: HTMLElement) {
  element.style.boxShadow = HIGHLIGHT_BOX_SHADOW;
  setTimeout(() => {
    element.style.boxShadow = '';
  }, 7000);
}
/** Builds the DOM element ID for a file-entry header row, used by scrollItemIntoView and temporaryHighlightItem. */
export const buildEntryHeaderId = (filePath: string) => `entry-${encodeURIComponent(filePath)}`;

/** Scroll position that centers `element` within `container`, clamped to the valid range. */
const computeCenteredScrollTop = (container: HTMLElement, element: HTMLElement): number => {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  // Element's position relative to the container's content (not its viewport)
  const elementTopInContainer = elementRect.top - containerRect.top + container.scrollTop;
  const targetScrollTop = elementTopInContainer - (containerRect.height / 2) + (elementRect.height / 2);

  const maxScrollTop = container.scrollHeight - containerRect.height;
  return Math.max(0, Math.min(targetScrollTop, maxScrollTop));
};

/**
 * Scrolls an item into view within the main content area.
 * Uses manual scroll calculation to avoid scrollIntoView's side effect
 * of scrolling all ancestors (which can break the layout in Electron).
 *
 * Returns `true` if the target element was found (and scrolled), `false`
 * otherwise. Callers use this to avoid consuming a pending-scroll request
 * before the target folder's entries have actually rendered.
 */
export const scrollItemIntoView = (filePath: string, highlight = false): boolean => {
  const targetId = buildEntryHeaderId(filePath);
  const element = document.getElementById(targetId);
  if (!element) return false;

  // Find the scrollable main container that actually contains this element.
  // Using element.closest('main') (rather than a global document.querySelector)
  // is important because inactive views stay mounted (display:none) and also
  // render their own <main>; a global query could grab a hidden one.
  const scrollContainer = element.closest('main');
  if (!scrollContainer) {
    if (highlight) temporaryHighlightItem(element);
    // Fallback to scrollIntoView if container not found
    element.scrollIntoView({ block: 'center' });
    return true;
  }

  if (highlight) temporaryHighlightItem(element);

  scrollContainer.scrollTo({
    top: computeCenteredScrollTop(scrollContainer, element),
    behavior: 'instant'
  });
  return true;
};

// How often to check whether the scroll target has rendered yet, and for how
// long, before giving up (e.g. a stale heading slug that no longer exists).
const FIND_ELEMENT_INTERVAL_MS = 100;
const FIND_ELEMENT_TIMEOUT_MS = 3000;
// After the initial scroll, keep re-centering for this long while late-loading
// content (mermaid diagrams, KaTeX, images without known dimensions) reflows
// the document above the target.
const SETTLE_WINDOW_MS = 2500;
// Ignore drift smaller than this; also keeps a smooth scroll already heading
// to the right position from being re-issued for sub-pixel differences.
const SETTLE_TOLERANCE_PX = 4;
// One-shot mode (DYNAMIC_SCROLL_TO_ELEMENT=false) only: since there are no
// follow-up corrections, give late-rendering content a fixed grace period to
// reflow the page before taking the single shot at the scroll position.
const ONE_SHOT_SCROLL_DELAY_MS = 1000;

/**
 * Scrolls an arbitrary DOM element (identified by id) into view within the
 * main content area, then holds it there while the page settles. Used to
 * scroll to a specific markdown heading after navigating from the IndexTree.
 *
 * Two problems make a one-shot scroll unreliable, and this handles both:
 * - The target may not exist yet (the markdown entry is still expanding/
 *   rendering), so it polls for the element for up to a few seconds instead
 *   of relying on a fixed delay.
 * - Content rendered asynchronously above the target (mermaid, KaTeX, images
 *   whose dimensions couldn't be pre-reserved) shifts the target after the
 *   scroll, so a ResizeObserver re-centers it whenever the layout changes
 *   during the settle window.
 *
 * Fire-and-forget: it self-cancels when the user intervenes (wheel, touch,
 * scrollbar drag, key press), when the target leaves the DOM (navigation),
 * and when the settle window elapses — callers don't need to clean it up.
 *
 * The second (settle) behavior can be disabled via DYNAMIC_SCROLL_TO_ELEMENT
 * at the top of this file.
 */
export const scrollElementIntoView = (elementId: string, highlight: boolean): void => {
  // The element usually exists already (document open and rendered) — only
  // fall back to polling when it doesn't.
  const element = document.getElementById(elementId);
  if (element) {
    beginSettledScroll(element, highlight);
    return;
  }

  const startTime = Date.now();
  const findTimer = setInterval(() => {
    const found = document.getElementById(elementId);
    if (found) {
      clearInterval(findTimer);
      beginSettledScroll(found, highlight);
    } else if (Date.now() - startTime > FIND_ELEMENT_TIMEOUT_MS) {
      clearInterval(findTimer);
    }
  }, FIND_ELEMENT_INTERVAL_MS);
};

/**
 * Highlights the element and smooth-scrolls it to the center of its <main>
 * container. Returns the container, or null when none was found (in which
 * case a plain scrollIntoView fallback was used).
 */
const centerScrollOnElement = (element: HTMLElement, highlight: boolean): HTMLElement | null => {
  if (highlight) temporaryHighlightItem(element);

  // See scrollItemIntoView: resolve the container from the target element so we
  // don't accidentally pick a hidden, still-mounted view's <main>.
  const scrollContainer = element.closest('main');
  if (!scrollContainer) {
    element.scrollIntoView({ block: 'center' });
    return null;
  }

  scrollContainer.scrollTo({
    top: computeCenteredScrollTop(scrollContainer, element),
    behavior: 'smooth'
  });
  return scrollContainer;
};

/** Initial centering scroll plus the self-cancelling settle/correction phase. */
const beginSettledScroll = (element: HTMLElement, highlight: boolean): void => {
  // One-shot mode: delay the single scroll instead of correcting afterwards,
  // then stop — no correction phase, no listeners to clean up.
  if (!DYNAMIC_SCROLL_TO_ELEMENT) {
    setTimeout(() => {
      if (element.isConnected) centerScrollOnElement(element, highlight);
    }, ONE_SHOT_SCROLL_DELAY_MS);
    return;
  }

  const scrollContainer = centerScrollOnElement(element, highlight);
  if (!scrollContainer) return;

  // Everything in the settle phase (event listeners, observer, timer) tears
  // down through this one controller, whichever cancellation path fires first.
  const controller = new AbortController();
  const { signal } = controller;
  const cancel = () => controller.abort();

  // Any user interaction that could mean "I'm scrolling myself now" ends the
  // correction phase immediately — never fight the user for the scrollbar.
  // (mousedown covers scrollbar drags; keydown covers PageUp/Down, arrows,
  // space. Programmatic smooth scrolling fires none of these.)
  scrollContainer.addEventListener('wheel', cancel, { passive: true, signal });
  scrollContainer.addEventListener('touchstart', cancel, { passive: true, signal });
  scrollContainer.addEventListener('mousedown', cancel, { passive: true, signal });
  window.addEventListener('keydown', cancel, { passive: true, signal });

  // Watch the container's direct children rather than the container itself:
  // the container's own border box never changes when content reflows, but
  // any growth deeper in the tree propagates up to a direct child's height.
  const observer = new ResizeObserver(() => {
    if (!element.isConnected) {
      cancel();
      return;
    }
    const desired = computeCenteredScrollTop(scrollContainer, element);
    if (Math.abs(scrollContainer.scrollTop - desired) > SETTLE_TOLERANCE_PX) {
      scrollContainer.scrollTo({ top: desired, behavior: 'smooth' });
    }
  });
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  for (const child of Array.from(scrollContainer.children)) {
    observer.observe(child);
  }

  // Content that arrives late as a *new* direct child of the container (rather
  // than growing an existing one) would otherwise reflow the page unobserved,
  // so pick up new children as they mount. Observing a child also delivers an
  // immediate ResizeObserver callback, which doubles as the correction for the
  // reflow the insertion caused.
  const childWatcher = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof Element) observer.observe(node);
      }
    }
  });
  signal.addEventListener('abort', () => childWatcher.disconnect(), { once: true });
  childWatcher.observe(scrollContainer, { childList: true });

  const stopTimer = setTimeout(cancel, SETTLE_WINDOW_MS);
  signal.addEventListener('abort', () => clearTimeout(stopTimer), { once: true });
};
