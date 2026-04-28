import type { Page, Locator } from '@playwright/test';

const HIGHLIGHT = {
  // border: '2px solid #ff4444',
  boxShadow: '0 0 30px rgba(255, 68, 68, 0.8), inset 0 0 20px rgba(255, 68, 68, 0.2)',
  outline: '2px solid #ff6666',
  outlineOffset: '2px',
} as const;

/**
 * Visual indicator helpers for creating demonstration videos.
 * These functions add visual cues before taking screenshots to show
 * where user interactions are happening.
 */

/**
 * Highlights an element with a pulsing border before taking action on it.
 * Useful for showing which element will be clicked.
 */
export async function highlightElement(
  page: Page,
  locator: Locator,
  duration = 800
): Promise<void> {
  await locator.evaluate((element, { dur, styles }) => {
    // Store original styles
    const originalOutline = element.style.outline;
    const originalOutlineOffset = element.style.outlineOffset;
    const originalBoxShadow = element.style.boxShadow;

    // Add highlight using consistent styles
    element.style.setProperty('outline', styles.outline, 'important');
    element.style.setProperty('outline-offset', styles.outlineOffset, 'important');
    element.style.setProperty('box-shadow', styles.boxShadow, 'important');

    // Restore after duration
    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.outlineOffset = originalOutlineOffset;
      element.style.boxShadow = originalBoxShadow;
    }, dur);
  }, { dur: duration, styles: HIGHLIGHT });

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

  // Apply persistent highlight to the input area
  if (showHighlight) {
    if (locator) {
      // When we have a locator, apply styles directly to the known element
      // (locator.evaluate passes the DOM element directly — no need to search for it)
      await locator.evaluate((element, { dur, styles }) => {
        // const originalBorder = element.style.border;
        const originalBoxShadow = element.style.boxShadow;
        const originalOutline = element.style.outline;
        const originalOutlineOffset = element.style.outlineOffset;

        // element.style.setProperty('border', styles.border, 'important');
        element.style.setProperty('box-shadow', styles.boxShadow, 'important');
        element.style.setProperty('outline', styles.outline, 'important');
        element.style.setProperty('outline-offset', styles.outlineOffset, 'important');

        setTimeout(() => {
          // element.style.border = originalBorder;
          element.style.boxShadow = originalBoxShadow;
          element.style.outline = originalOutline;
          element.style.outlineOffset = originalOutlineOffset;
        }, dur);
      }, { dur: highlightDuration, styles: HIGHLIGHT });
    } else {
      // No locator — find CodeMirror editor or fall back to focused element
      await page.evaluate(({ dur, styles }) => {
        let editorElement: HTMLElement | null = null;

        const cmEditor = document.querySelector('.cm-editor');
        if (cmEditor) {
          // Get the container div (parent of .cm-editor)
          editorElement = cmEditor.parentElement?.closest('.rounded') as HTMLElement;
          if (!editorElement) {
            editorElement = cmEditor as HTMLElement;
          }
        } else {
          editorElement = document.activeElement as HTMLElement;
        }

        if (!editorElement) {
          console.warn('No editor element found for highlighting');
          return;
        }

        // const originalBorder = editorElement.style.border;
        const originalBoxShadow = editorElement.style.boxShadow;
        const originalOutline = editorElement.style.outline;

        // editorElement.style.setProperty('border', styles.border, 'important');
        editorElement.style.setProperty('box-shadow', styles.boxShadow, 'important');
        editorElement.style.setProperty('outline', styles.outline, 'important');
        editorElement.style.setProperty('outline-offset', styles.outlineOffset, 'important');

        setTimeout(() => {
          // editorElement!.style.border = originalBorder;
          editorElement!.style.boxShadow = originalBoxShadow;
          editorElement!.style.outline = originalOutline;
        }, dur);
      }, { dur: highlightDuration, styles: HIGHLIGHT });
    }

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
 * Bulk-inserts text into the focused CodeMirror editor via its API.
 * Unlike demonstrateTyping which simulates keystrokes one at a time,
 * this dispatches a single transaction — instant and immune to
 * auto-indent or other keystroke-triggered behavior.
 *
 * Optionally applies a highlight to the editor for demo screenshots.
 */
export async function insertText(
  page: Page,
  text: string,
  options: {
    showHighlight?: boolean;
    pauseBefore?: number;
    pauseAfter?: number;
    highlightDuration?: number;
  } = {}
): Promise<void> {
  const {
    showHighlight = true,
    pauseBefore = 500,
    pauseAfter = 800,
    highlightDuration = 5000,
  } = options;

  // Apply persistent highlight to the editor
  if (showHighlight) {
    await page.evaluate(({ dur, styles }) => {
      let editorElement: HTMLElement | null = null;

      const cmEditor = document.querySelector('.cm-editor');
      if (cmEditor) {
        editorElement = cmEditor.parentElement?.closest('.rounded') as HTMLElement;
        if (!editorElement) {
          editorElement = cmEditor as HTMLElement;
        }
      } else {
        editorElement = document.activeElement as HTMLElement;
      }

      if (!editorElement) {
        console.warn('No editor element found for highlighting');
        return;
      }

      const originalBoxShadow = editorElement.style.boxShadow;
      const originalOutline = editorElement.style.outline;

      editorElement.style.setProperty('box-shadow', styles.boxShadow, 'important');
      editorElement.style.setProperty('outline', styles.outline, 'important');
      editorElement.style.setProperty('outline-offset', styles.outlineOffset, 'important');

      setTimeout(() => {
        editorElement!.style.boxShadow = originalBoxShadow;
        editorElement!.style.outline = originalOutline;
      }, dur);
    }, { dur: highlightDuration, styles: HIGHLIGHT });

    await page.waitForTimeout(300);
  }

  await page.waitForTimeout(pauseBefore);

  // Bulk-insert text as a single input event (like a paste).
  // Unlike keyboard.type(), this doesn't fire individual key events,
  // so CodeMirror's auto-indent is never triggered.
  await page.keyboard.insertText(text);

  await page.waitForTimeout(pauseAfter);
}

/**
 * Takes a screenshot with a red highlight border on the specified element.
 * Applies the border, captures the screenshot, then removes the border — all atomically.
 * This guarantees the highlight is always visible in the captured image regardless of timing.
 */
export async function screenshotWithHighlight(
  page: Page,
  locator: Locator,
  screenshotPath: string
): Promise<void> {
  // Apply highlight. For checkbox/radio inputs, walk up to the closest ancestor
  // <label> so the outline encompasses the indicator and the label text together.
  await locator.evaluate((element, styles) => {
    const target: HTMLElement =
      (element instanceof HTMLInputElement &&
        (element.type === 'checkbox' || element.type === 'radio'))
        ? (element.closest('label') ?? element) as HTMLElement
        : element as HTMLElement;

    target.dataset.origBoxShadow = target.style.boxShadow;
    target.dataset.origOutline = target.style.outline;
    target.dataset.origOutlineOffset = target.style.outlineOffset;

    target.style.setProperty('box-shadow', styles.boxShadow, 'important');
    target.style.setProperty('outline', styles.outline, 'important');
    target.style.setProperty('outline-offset', styles.outlineOffset, 'important');
  }, HIGHLIGHT);

  // Wait for the browser to paint the styles
  await page.waitForTimeout(150);

  // Capture the screenshot
  await page.screenshot({ path: screenshotPath });

  // Remove highlight
  await locator.evaluate((element) => {
    const target: HTMLElement =
      (element instanceof HTMLInputElement &&
        (element.type === 'checkbox' || element.type === 'radio'))
        ? (element.closest('label') ?? element) as HTMLElement
        : element as HTMLElement;

    target.style.boxShadow = target.dataset.origBoxShadow || '';
    target.style.outline = target.dataset.origOutline || '';
    target.style.outlineOffset = target.dataset.origOutlineOffset || '';

    delete target.dataset.origBoxShadow;
    delete target.dataset.origOutline;
    delete target.dataset.origOutlineOffset;
  });
}
