import type { Page, Locator } from '@playwright/test';

export const HIGHLIGHT = {
  boxShadow: '0 0 30px rgba(255, 68, 68, 0.8), inset 0 0 20px rgba(255, 68, 68, 0.2)',
  border: '2px solid #ff6666',
} as const;

const HIGHLIGHT_OVERLAY_ID = '__mkb_highlight_overlay__';

/**
 * Visual indicator helpers for creating demonstration videos.
 * These functions add visual cues before taking screenshots to show
 * where user interactions are happening.
 *
 * All highlighting is drawn by showHighlightOverlay as a standalone overlay
 * <div> appended to <body>, rather than by styling the target element itself:
 * an element's own outline/box-shadow gets clipped by any ancestor with
 * `overflow: hidden`/`auto`, whereas the overlay is position:fixed at the
 * element's absolute viewport coordinates, clamped to the viewport so it can
 * never be truncated by the window edge, and pointer-events:none so it never
 * interferes with clicks or typing.
 *
 * The overlay is promoted into the browser's top layer via the Popover API
 * (popover="manual" + showPopover()). The app's dialogs (<dialog>.showModal())
 * and popup menus (Popover API) live in the top layer, which paints above ALL
 * z-indexes — so no z-index on the overlay could beat them. Top-layer elements
 * stack in promotion order, and the overlay is always shown after the
 * dialog/menu is already open, so it is guaranteed to paint on top.
 */

/**
 * Draws the highlight overlay box around the element resolved from `locator`.
 *
 * If `locator` is null, falls back to the CodeMirror editor container, or
 * failing that the currently focused element (for the "highlight whatever
 * we're typing into" callers). Checkbox/radio inputs are widened to their
 * closest ancestor <label> so the indicator and label text are boxed together.
 *
 * If `durationMs` is provided the overlay removes itself after that long;
 * otherwise it persists until removeHighlightOverlay() is called. In either
 * mode the overlay is also removed as soon as the highlighted element leaves
 * the DOM or stops being visible (e.g. its view is hidden with display:none),
 * so a fast-moving test can never leave a stale box over new content.
 */
export async function showHighlightOverlay(
  page: Page,
  locator: Locator | null,
  durationMs?: number
): Promise<void> {
  const el = locator ? await locator.elementHandle() : null;
  await page.evaluate(({ el, styles, overlayId, dur }) => {
    // Resolve the element to draw the box around. With no element provided,
    // find the CodeMirror editor container or fall back to the focused element.
    let target = el as HTMLElement | null;
    if (!target) {
      const cmEditor = document.querySelector('.cm-editor');
      if (cmEditor) {
        // Prefer the rounded container div wrapping the editor
        target = (cmEditor.parentElement?.closest('.rounded') ?? cmEditor) as HTMLElement;
      } else {
        target = document.activeElement as HTMLElement | null;
      }
    }
    if (!target) {
      // Runs inside page.evaluate (browser context); logUtil logger isn't available here.
      // eslint-disable-next-line no-console
      console.warn('No element found for highlighting');
      return;
    }

    // For checkbox/radio inputs, walk up to the closest ancestor <label> so
    // the box encompasses the indicator and the label text together.
    if (
      target instanceof HTMLInputElement &&
      (target.type === 'checkbox' || target.type === 'radio')
    ) {
      target = (target.closest('label') ?? target) as HTMLElement;
    }

    const rect = target.getBoundingClientRect();

    // Expand outward: 2px breathing room + 2px border width.
    const pad = 4;
    let left = rect.left - pad;
    let top = rect.top - pad;
    let right = rect.right + pad;
    let bottom = rect.bottom + pad;

    // Clamp to the viewport so the box is always fully visible on screen.
    const margin = 1;
    left = Math.max(left, margin);
    top = Math.max(top, margin);
    right = Math.min(right, window.innerWidth - margin);
    bottom = Math.min(bottom, window.innerHeight - margin);

    // Remove any stale overlay from a previous (interrupted) call.
    document.getElementById(overlayId)?.remove();

    const overlay = document.createElement('div');
    overlay.id = overlayId;
    overlay.setAttribute('popover', 'manual');
    overlay.style.cssText = [
      'position: fixed',
      `left: ${left}px`,
      `top: ${top}px`,
      `width: ${right - left}px`,
      `height: ${bottom - top}px`,
      // Neutralise the UA [popover] defaults (inset: 0; margin: auto; padding;
      // border; opaque background) so our box geometry and styling win.
      'right: auto',
      'bottom: auto',
      'margin: 0',
      'padding: 0',
      'background: transparent',
      'overflow: visible',
      'box-sizing: border-box',
      `border: ${styles.border}`,
      `box-shadow: ${styles.boxShadow}`,
      'pointer-events: none',
      'z-index: 2147483647',
    ].join('; ');
    document.body.appendChild(overlay);

    // Promote into the top layer, above any open modal <dialog> or popover
    // menu (top-layer elements stack in promotion order; we're shown last).
    // "manual" popovers aren't light-dismissed by open modals.
    try {
      overlay.showPopover();
    } catch {
      // Popover API unavailable — [popover] elements are display:none until
      // shown, so drop the attribute to fall back to a plain fixed div.
      overlay.removeAttribute('popover');
    }

    // Tie the overlay's lifecycle to the target's. The overlay is a detached
    // fixed-position box, so without this it would outlive the element it
    // highlights and sit over whatever renders next. A per-frame check (rather
    // than a MutationObserver) also catches the app's hide-don't-unmount
    // pattern: views are hidden with display:none, so the target can vanish
    // visually without ever leaving the DOM.
    const tracked = target;
    const tick = () => {
      if (!overlay.isConnected) {
        return; // already removed by timeout / removeHighlightOverlay
      }
      const gone =
        !tracked.isConnected ||
        !tracked.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      if (gone) {
        overlay.remove();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    if (dur !== null) {
      setTimeout(() => overlay.remove(), dur);
    }
  }, { el, styles: HIGHLIGHT, overlayId: HIGHLIGHT_OVERLAY_ID, dur: durationMs ?? null });
}

/** Removes the highlight overlay immediately (for overlays shown without a duration). */
export async function removeHighlightOverlay(page: Page): Promise<void> {
  await page.evaluate((overlayId) => {
    document.getElementById(overlayId)?.remove();
  }, HIGHLIGHT_OVERLAY_ID);
}

/**
 * Highlights an element with a glowing border before taking action on it.
 * Useful for showing which element will be clicked.
 */
export async function highlightElement(
  page: Page,
  locator: Locator,
  duration = 800
): Promise<void> {
  await showHighlightOverlay(page, locator, duration);

  // Wait for the highlight to be visible
  await page.waitForTimeout(300);
}

/**
 * Combined action: highlight focused input, then type.
 * This is the recommended way to demonstrate text input in videos.
 * The highlight persists during typing so screenshots show where input occurs.
 * Handles CodeMirror editors specially by finding and highlighting the editor container.
 */
export async function demonstrateTyping(
  page: Page,
  text: string,
  options: {
    locator?: Locator; // Optional locator to focus and type into
    showHighlight?: boolean;
    pauseBefore?: number;
    pauseAfter?: number;
    typingDelay?: number;
    highlightDuration?: number;
  } = {}
): Promise<void> {
  const {
    locator,
    showHighlight = true,
    pauseBefore = 500,
    pauseAfter = 800,
    typingDelay = 100,
    highlightDuration = 5000, // Keep highlight visible long enough for typing + screenshot
  } = options;

  // If a locator is provided, focus it first
  if (locator) {
    await locator.click();
    await page.waitForTimeout(100); // Wait for focus
  }

  // Apply persistent highlight to the input area (with no locator, the overlay
  // helper falls back to the CodeMirror editor / focused element)
  if (showHighlight) {
    await showHighlightOverlay(page, locator ?? null, highlightDuration);
    await page.waitForTimeout(300); // Let highlight render
  }

  // Pause before typing
  await page.waitForTimeout(pauseBefore);

  // Type with delay for visual effect
  await page.keyboard.type(text, { delay: typingDelay });

  // Pause after typing (highlight still visible)
  await page.waitForTimeout(pauseAfter);
}

/**
 * Takes a screenshot with a red highlight border on the specified element.
 * Shows the overlay, captures the screenshot, then removes it — all atomically.
 * This guarantees the highlight is always visible in the captured image
 * regardless of timing.
 */
export async function screenshotWithHighlight(
  page: Page,
  locator: Locator,
  screenshotPath: string
): Promise<void> {
  await showHighlightOverlay(page, locator);

  try {
    // Wait for the browser to paint the overlay
    await page.waitForTimeout(150);

    // Capture the screenshot
    await page.screenshot({ path: screenshotPath });
  } finally {
    await removeHighlightOverlay(page);
  }
}
