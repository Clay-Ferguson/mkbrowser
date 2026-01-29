export const buildEntryHeaderId = (fileName: string) => `entry-${encodeURIComponent(fileName)}`;

/**
 * Scrolls an item into view within the main content area.
 * Uses manual scroll calculation to avoid scrollIntoView's side effect
 * of scrolling all ancestors (which can break the layout in Electron).
 */
export const scrollItemIntoView = (fileName: string) => {
  const targetId = buildEntryHeaderId(fileName);
  const element = document.getElementById(targetId);
  if (!element) return;

  // Find the scrollable main container (the element with overflow-y-auto)
  const scrollContainer = document.querySelector('main');
  if (!scrollContainer) {
    // Fallback to scrollIntoView if container not found
    element.scrollIntoView({ block: 'center' });
    return;
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

  scrollContainer.scrollTo({
    top: clampedScrollTop,
    behavior: 'instant'
  });
};
