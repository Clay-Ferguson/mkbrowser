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

    // Add highlight
    element.style.outline = '3px solid #ff4444';
    element.style.outlineOffset = '2px';
    element.style.boxShadow = '0 0 20px rgba(255, 68, 68, 0.6)';

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
 * Shows a click indicator (ripple effect) at the element's location.
 * Call this right after clicking to show where the click happened.
 */
export async function showClickIndicator(
  page: Page,
  locator: Locator,
  duration: number = 1000
): Promise<void> {
  await locator.evaluate((element, dur) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Create ripple element
    const ripple = document.createElement('div');
    ripple.style.position = 'fixed';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.width = '20px';
    ripple.style.height = '20px';
    ripple.style.borderRadius = '50%';
    ripple.style.border = '3px solid #ff4444';
    ripple.style.backgroundColor = 'rgba(255, 68, 68, 0.2)';
    ripple.style.transform = 'translate(-50%, -50%) scale(1)';
    ripple.style.pointerEvents = 'none';
    ripple.style.zIndex = '999999';
    ripple.style.transition = 'all 0.6s ease-out';

    document.body.appendChild(ripple);

    // Trigger animation
    setTimeout(() => {
      ripple.style.transform = 'translate(-50%, -50%) scale(3)';
      ripple.style.opacity = '0';
    }, 50);

    // Remove after animation
    setTimeout(() => {
      ripple.remove();
    }, dur);
  }, duration);

  await page.waitForTimeout(duration);
}

/**
 * Shows a cursor pointer at the element's location.
 * Useful for indicating where an action will occur.
 */
export async function showCursorAt(
  page: Page,
  locator: Locator,
  duration: number = 800
): Promise<void> {
  await locator.evaluate((element, dur) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Create cursor element (hand pointer)
    const cursor = document.createElement('div');
    cursor.innerHTML = '👆';
    cursor.style.position = 'fixed';
    cursor.style.left = `${x - 10}px`;
    cursor.style.top = `${y - 30}px`;
    cursor.style.fontSize = '32px';
    cursor.style.pointerEvents = 'none';
    cursor.style.zIndex = '999999';
    cursor.style.animation = 'bounce 0.5s ease-in-out infinite';
    cursor.style.filter = 'drop-shadow(2px 2px 4px rgba(0,0,0,0.5))';

    // Add bounce animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(cursor);

    // Remove after duration
    setTimeout(() => {
      cursor.remove();
      style.remove();
    }, dur);
  }, duration);

  await page.waitForTimeout(duration);
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

  await page.waitForTimeout(duration);
}

/**
 * Combined action: highlight, show cursor, then perform action.
 * This is the recommended way to demonstrate clicks in videos.
 */
export async function demonstrateClick(
  page: Page,
  locator: Locator,
  options: {
    showCursor?: boolean;
    showRipple?: boolean;
    pauseBefore?: number;
    pauseAfter?: number;
  } = {}
): Promise<void> {
  const {
    showCursor = true,
    showRipple = true,
    pauseBefore = 500,
    pauseAfter = 500,
  } = options;

  // Highlight the element
  await highlightElement(page, locator, 800);

  // Show cursor
  if (showCursor) {
    await showCursorAt(page, locator, 600);
  }

  // Pause before click
  await page.waitForTimeout(pauseBefore);

  // Show click ripple BEFORE clicking (since element might disappear after click)
  if (showRipple) {
    // Get position and create ripple that will persist
    await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      // Create ripple element
      const ripple = document.createElement('div');
      ripple.style.position = 'fixed';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.style.width = '20px';
      ripple.style.height = '20px';
      ripple.style.borderRadius = '50%';
      ripple.style.border = '3px solid #ff4444';
      ripple.style.backgroundColor = 'rgba(255, 68, 68, 0.2)';
      ripple.style.transform = 'translate(-50%, -50%) scale(1)';
      ripple.style.pointerEvents = 'none';
      ripple.style.zIndex = '999999';
      ripple.style.transition = 'all 0.6s ease-out';

      document.body.appendChild(ripple);

      // Trigger animation
      setTimeout(() => {
        ripple.style.transform = 'translate(-50%, -50%) scale(3)';
        ripple.style.opacity = '0';
      }, 50);

      // Remove after animation
      setTimeout(() => {
        ripple.remove();
      }, 1000);
    });
    await page.waitForTimeout(200);
  }

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
    showHighlight?: boolean;
    pauseBefore?: number;
    pauseAfter?: number;
    typingDelay?: number;
    highlightDuration?: number;
  } = {}
): Promise<void> {
  const {
    showHighlight = true,
    pauseBefore = 500,
    pauseAfter = 800,
    typingDelay = 100,
    highlightDuration = 5000, // Keep highlight visible long enough for typing + screenshot
  } = options;

  // Apply persistent highlight to the input area
  if (showHighlight) {
    // Find and highlight the editor - handle both regular inputs and CodeMirror
    await page.evaluate((dur) => {
      let editorElement: HTMLElement | null = null;

      // Try to find CodeMirror editor container (the parent with rounded borders)
      const cmEditor = document.querySelector('.cm-editor');
      if (cmEditor) {
        // Get the container div (parent of .cm-editor)
        editorElement = cmEditor.parentElement?.closest('.rounded') as HTMLElement;
        if (!editorElement) {
          editorElement = cmEditor as HTMLElement;
        }
      } else {
        // Fall back to focused element
        editorElement = document.activeElement as HTMLElement;
      }

      if (!editorElement) {
        console.warn('No editor element found for highlighting');
        return;
      }

      // Store original styles
      const originalBorder = editorElement.style.border;
      const originalBoxShadow = editorElement.style.boxShadow;
      const originalOutline = editorElement.style.outline;

      // Add highly visible highlight that overrides everything
      editorElement.style.setProperty('border', '4px solid #ff4444', 'important');
      editorElement.style.setProperty('box-shadow', '0 0 30px rgba(255, 68, 68, 0.8), inset 0 0 20px rgba(255, 68, 68, 0.2)', 'important');
      editorElement.style.setProperty('outline', '2px solid #ff6666', 'important');
      editorElement.style.setProperty('outline-offset', '2px', 'important');

      // Auto-cleanup after duration
      setTimeout(() => {
        editorElement!.style.border = originalBorder;
        editorElement!.style.boxShadow = originalBoxShadow;
        editorElement!.style.outline = originalOutline;
      }, dur);
    }, highlightDuration);

    await page.waitForTimeout(300); // Let highlight render
  }

  // Pause before typing
  await page.waitForTimeout(pauseBefore);

  // Type with delay for visual effect
  await page.keyboard.type(text, { delay: typingDelay });

  // Pause after typing (highlight still visible)
  await page.waitForTimeout(pauseAfter);
}
