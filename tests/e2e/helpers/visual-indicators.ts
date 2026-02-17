import type { Page, Locator } from '@playwright/test';

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
  duration: number = 800
): Promise<void> {
  await locator.evaluate((element, dur) => {
    // Store original styles
    const originalOutline = element.style.outline;
    const originalOutlineOffset = element.style.outlineOffset;
    const originalBoxShadow = element.style.boxShadow;

    // Add highlight with thick, very visible border
    element.style.outline = '6px solid #ff4444';
    element.style.outlineOffset = '3px';
    element.style.boxShadow = '0 0 40px rgba(255, 68, 68, 0.9), 0 0 20px rgba(255, 68, 68, 0.7)';

    // Restore after duration
    setTimeout(() => {
      element.style.outline = originalOutline;
      element.style.outlineOffset = originalOutlineOffset;
      element.style.boxShadow = originalBoxShadow;
    }, dur);
  }, duration);

  // Wait for the highlight to be visible
  await page.waitForTimeout(100);
}

/**
 * Shows a "typing" indicator near the focused element.
 * Useful for demonstrating text input.
 */
export async function showTypingIndicator(
  page: Page,
  locator: Locator,
  duration: number = 1500
): Promise<void> {
  await locator.evaluate((element, dur) => {
    const rect = element.getBoundingClientRect();

    // Create typing indicator
    const indicator = document.createElement('div');
    indicator.textContent = '⌨️ typing...';
    indicator.style.position = 'fixed';
    indicator.style.left = `${rect.left}px`;
    indicator.style.top = `${rect.top - 40}px`;
    indicator.style.padding = '4px 12px';
    indicator.style.backgroundColor = 'rgba(68, 138, 255, 0.9)';
    indicator.style.color = 'white';
    indicator.style.borderRadius = '4px';
    indicator.style.fontSize = '14px';
    indicator.style.fontWeight = 'bold';
    indicator.style.pointerEvents = 'none';
    indicator.style.zIndex = '999999';
    indicator.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    indicator.style.animation = 'pulse 1s ease-in-out infinite';

    // Add pulse animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(indicator);

    // Remove after duration
    setTimeout(() => {
      indicator.remove();
      style.remove();
    }, dur);
  }, duration);

  // Wait for the indicator to be visible (but return before it's removed)
  await page.waitForTimeout(200);
}

/**
 * Combined action: highlight then perform action.
 * This is the recommended way to demonstrate clicks in videos.
 */
export async function demonstrateClick(
  page: Page,
  locator: Locator,
  options: {
    pauseBefore?: number;
    pauseAfter?: number;
  } = {}
): Promise<void> {
  const {
    pauseBefore = 500,
    pauseAfter = 500,
  } = options;

  // Highlight the element
  await highlightElement(page, locator, 800);

  // Pause before click
  await page.waitForTimeout(pauseBefore);

  // Perform the click
  await locator.click();

  // Pause after click
  await page.waitForTimeout(pauseAfter);
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
      await locator.evaluate((element, dur) => {
        const originalBorder = element.style.border;
        const originalBoxShadow = element.style.boxShadow;
        const originalOutline = element.style.outline;
        const originalOutlineOffset = element.style.outlineOffset;

        element.style.setProperty('border', '4px solid #ff4444', 'important');
        element.style.setProperty('box-shadow', '0 0 30px rgba(255, 68, 68, 0.8), inset 0 0 20px rgba(255, 68, 68, 0.2)', 'important');
        element.style.setProperty('outline', '2px solid #ff6666', 'important');
        element.style.setProperty('outline-offset', '2px', 'important');

        setTimeout(() => {
          element.style.border = originalBorder;
          element.style.boxShadow = originalBoxShadow;
          element.style.outline = originalOutline;
          element.style.outlineOffset = originalOutlineOffset;
        }, dur);
      }, highlightDuration);
    } else {
      // No locator — find CodeMirror editor or fall back to focused element
      await page.evaluate((dur) => {
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

        const originalBorder = editorElement.style.border;
        const originalBoxShadow = editorElement.style.boxShadow;
        const originalOutline = editorElement.style.outline;

        editorElement.style.setProperty('border', '4px solid #ff4444', 'important');
        editorElement.style.setProperty('box-shadow', '0 0 30px rgba(255, 68, 68, 0.8), inset 0 0 20px rgba(255, 68, 68, 0.2)', 'important');
        editorElement.style.setProperty('outline', '2px solid #ff6666', 'important');
        editorElement.style.setProperty('outline-offset', '2px', 'important');

        setTimeout(() => {
          editorElement!.style.border = originalBorder;
          editorElement!.style.boxShadow = originalBoxShadow;
          editorElement!.style.outline = originalOutline;
        }, dur);
      }, highlightDuration);
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
 * Takes a screenshot with a red highlight border on the specified element.
 * Applies the border, captures the screenshot, then removes the border — all atomically.
 * This guarantees the highlight is always visible in the captured image regardless of timing.
 */
export async function screenshotWithHighlight(
  page: Page,
  locator: Locator,
  screenshotPath: string
): Promise<void> {
  // Apply highlight
  await locator.evaluate((element) => {
    element.dataset.origBorder = element.style.border;
    element.dataset.origBoxShadow = element.style.boxShadow;
    element.dataset.origOutline = element.style.outline;
    element.dataset.origOutlineOffset = element.style.outlineOffset;

    element.style.setProperty('border', '4px solid #ff4444', 'important');
    element.style.setProperty('box-shadow', '0 0 30px rgba(255, 68, 68, 0.8), inset 0 0 20px rgba(255, 68, 68, 0.2)', 'important');
    element.style.setProperty('outline', '2px solid #ff6666', 'important');
    element.style.setProperty('outline-offset', '2px', 'important');
  });

  // Wait for the browser to paint the styles
  await page.waitForTimeout(150);

  // Capture the screenshot
  await page.screenshot({ path: screenshotPath });

  // Remove highlight
  await locator.evaluate((element) => {
    element.style.border = element.dataset.origBorder || '';
    element.style.boxShadow = element.dataset.origBoxShadow || '';
    element.style.outline = element.dataset.origOutline || '';
    element.style.outlineOffset = element.dataset.origOutlineOffset || '';

    delete element.dataset.origBorder;
    delete element.dataset.origBoxShadow;
    delete element.dataset.origOutline;
    delete element.dataset.origOutlineOffset;
  });
}
