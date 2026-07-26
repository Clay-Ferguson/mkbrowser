/**
 * Tracks whether the current mouse press started on an element's scrollbar, so the
 * markdown click-to-edit gesture can ignore it.
 *
 * A fenced code block wide enough to overflow gets its own horizontal scrollbar, and
 * pressing that scrollbar produces a mousedown/mouseup pair on the scrolling element
 * which bubbles up to the click-to-edit handlers (the entry content area in
 * MarkdownEntry, or an enclosing block component when the code block sits inside a
 * list item or blockquote) — so simply using the scrollbar would drop the user into
 * the editor.
 *
 * The mouseup can't be judged on its own: after a thumb drag the browser keeps
 * capturing the pointer, so the release can be reported at coordinates far outside
 * the element. The decision therefore has to be made at mousedown time and remembered
 * for the matching mouseup.
 */

// Set by every tracked mousedown (true or false), read by the mouseup handlers. Not
// cleared on read: a single press can bubble through more than one mouseup handler,
// and each of them needs the same answer.
let pressedOnScrollbar = false;

/**
 * True when the point lies inside the element's border box but outside its client
 * (padding) box on an axis that actually scrolls — that gutter is exactly where the
 * browser lays out a scrollbar, and it's the region clientWidth/clientHeight leave out.
 */
function isScrollbarPoint(el: HTMLElement, clientX: number, clientY: number): boolean {
  const rect = el.getBoundingClientRect();
  // clientLeft/clientTop are the border widths, so subtracting them yields
  // coordinates relative to the padding box (the same origin as clientWidth/Height).
  const x = clientX - rect.left - el.clientLeft;
  const y = clientY - rect.top - el.clientTop;
  const onVerticalBar = el.scrollHeight > el.clientHeight && x >= el.clientWidth;
  const onHorizontalBar = el.scrollWidth > el.clientWidth && y >= el.clientHeight;
  return onVerticalBar || onHorizontalBar;
}

/**
 * mousedown handler: records whether this press landed on a scrollbar. A press on a
 * scrollbar targets the scrolling element itself (scrollbars aren't child nodes), so
 * testing the event target is enough.
 */
export function trackScrollbarPress(e: React.MouseEvent): void {
  const target = e.target;
  pressedOnScrollbar = target instanceof HTMLElement && isScrollbarPoint(target, e.clientX, e.clientY);
}

/** True when the press that the current mouseup completes began on a scrollbar. */
export function pressStartedOnScrollbar(): boolean {
  return pressedOnScrollbar;
}
