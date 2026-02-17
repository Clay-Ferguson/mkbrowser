import type { Page, Locator } from '@playwright/test';
import { screenshotWithHighlight, demonstrateTyping, insertText } from './visual-indicators';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Media utilities for E2E tests - screenshot and video helpers.
 */

/**
 * Takes a screenshot with standardized naming.
 * 
 * @param mainWindow - The Playwright Page object
 * @param screenshotDir - Directory where screenshots are saved
 * @param step - Current step number
 * @param filenameSuffix - The descriptive suffix for the screenshot (e.g., 'files-visible')
 * 
 * @example
 * await takeStepScreenshot(mainWindow, screenshotDir, step++, 'files-visible');
 */
export async function takeStepScreenshot(
  mainWindow: Page,
  screenshotDir: string,
  step: number,
  filenameSuffix: string
): Promise<void> {
  await mainWindow.screenshot({
    path: path.join(screenshotDir, `${String(step).padStart(3, '0')}-${filenameSuffix}.png`)
  });
}

/**
 * Writes a narration text file with standardized naming.
 * 
 * @param screenshotDir - Directory where narration files are saved
 * @param step - Current step number
 * @param narrationText - The narration content to write
 * 
 * @example
 * writeNarration(screenshotDir, step++, 'Welcome to MkBrowser...');
 */
export function writeNarration(
  screenshotDir: string,
  step: number,
  narrationText: string
): void {
  fs.writeFileSync(
    path.join(screenshotDir, `${String(step).padStart(3, '0')}-narration.txt`),
    narrationText
  );
}

/**
 * Takes a screenshot with highlight and standardized naming.
 * 
 * @param mainWindow - The Playwright Page object
 * @param locator - The element to highlight in the screenshot
 * @param screenshotDir - Directory where screenshots are saved
 * @param step - Current step number
 * @param filenameSuffix - The descriptive suffix for the screenshot (e.g., 'filename-entered')
 * 
 * @example
 * await takeStepScreenshotWithHighlight(mainWindow, filenameInput, screenshotDir, step++, 'filename-entered');
 */
export async function takeStepScreenshotWithHighlight(
  mainWindow: Page,
  locator: Locator,
  screenshotDir: string,
  step: number,
  filenameSuffix: string
): Promise<void> {
  await screenshotWithHighlight(
    mainWindow,
    locator,
    path.join(screenshotDir, `${String(step).padStart(3, '0')}-${filenameSuffix}.png`)
  );
}

/**
 * Demonstrates typing with standard demo timing for video recording.
 * 
 * @param mainWindow - The Playwright Page object
 * @param text - The text to type
 * @param showHighlight - Whether to show visual highlight during typing
 * @param locator - Optional locator to focus and type into
 * @param typingDelay - Milliseconds between each keystroke (default: 35 for super fast but visible typing)
 * 
 * @example
 * await demonstrateTypingForDemo(mainWindow, 'this is a test', true);
 * await demonstrateTypingForDemo(mainWindow, 'my-journal-entry', true, filenameInput, 120);
 */
export async function demonstrateTypingForDemo(
  mainWindow: Page,
  text: string,
  showHighlight: boolean,
  locator?: Locator,
  typingDelay: number = 15
): Promise<void> {
  await demonstrateTyping(mainWindow, text, {
    locator,
    showHighlight,
    typingDelay,
    pauseAfter: 500,
    highlightDuration: 15000,
  });
}

/**
 * Bulk-inserts text into the CodeMirror editor for demo recordings.
 * Unlike demonstrateTypingForDemo (which types character-by-character),
 * this inserts all text at once via the CodeMirror API — avoiding any
 * auto-indent or keystroke-triggered behavior.
 *
 * @param mainWindow - The Playwright Page object
 * @param text - The text to insert
 * @param showHighlight - Whether to show visual highlight around the editor
 *
 * @example
 * await insertTextForDemo(mainWindow, mermaidContent, true);
 */
export async function insertTextForDemo(
  mainWindow: Page,
  text: string,
  showHighlight: boolean,
): Promise<void> {
  await insertText(mainWindow, text, {
    showHighlight,
    pauseAfter: 500,
    highlightDuration: 15000,
  });
}

/**
 * Demonstrates a click with standard demo timing for video recording.
 * Adds pauses before and after the click for visual clarity in demos.
 * 
 * @param locator - The element to click
 * 
 * @example
 * await demonstrateClickForDemo(createButton);
 */
export async function demonstrateClickForDemo(
  locator: Locator
): Promise<void> {
  await locator.page().waitForTimeout(300);
  await locator.click();
  await locator.page().waitForTimeout(1000);
}
