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

  // Calculate the scroll position to center the element
  const containerRect = scrollContainer.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  // Current scroll position
  const currentScrollTop = scrollContainer.scrollTop;

  // Element's position relative to the container's viewport
  const elementTopInContainer = elementRect.top - containerRect.top + currentScrollTop;

  // Calculate scroll position to center the element
  const containerHeight = containerRect.height;
  const elementHeight = elementRect.height;
  const targetScrollTop = elementTopInContainer - (containerHeight / 2) + (elementHeight / 2);

  // Clamp to valid scroll range
  const maxScrollTop = scrollContainer.scrollHeight - containerHeight;
  const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));

  if (highlight) temporaryHighlightItem(element);

  scrollContainer.scrollTo({
    top: clampedScrollTop,
    behavior: 'instant'
  });
  return true;
};

/**
 * Scrolls an arbitrary DOM element (identified by id) into view within the
 * main content area. Used to scroll to a specific markdown heading after
 * navigating from the IndexTree.
 */
export const scrollElementIntoView = (elementId: string, highlight: boolean) => {
  const element = document.getElementById(elementId);
  if (!element) return;

  // See scrollItemIntoView: resolve the container from the target element so we
  // don't accidentally pick a hidden, still-mounted view's <main>.
  const scrollContainer = element.closest('main');
  if (!scrollContainer) {
    if (highlight) temporaryHighlightItem(element);
    element.scrollIntoView({ block: 'center' });
    return;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const currentScrollTop = scrollContainer.scrollTop;
  const elementTopInContainer = elementRect.top - containerRect.top + currentScrollTop;
  const containerHeight = containerRect.height;
  const elementHeight = elementRect.height;
  const targetScrollTop = elementTopInContainer - (containerHeight / 2) + (elementHeight / 2);
  const maxScrollTop = scrollContainer.scrollHeight - containerHeight;
  const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));

  if (highlight) temporaryHighlightItem(element);
  scrollContainer.scrollTo({ top: clampedScrollTop, behavior: 'smooth' });
};
