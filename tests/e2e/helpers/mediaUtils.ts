import type { Page, Locator } from '@playwright/test';
import { screenshotWithHighlight, demonstrateTyping, insertText, highlightElement } from './visual-indicators';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Media utilities for E2E tests - screenshot and video helpers.
 */

/**
 * Log a summary of generated screenshots and narration files in a directory.
 */
export function logScreenshotSummary(screenshotDir: string): void {
  const files = fs.readdirSync(screenshotDir);
  const pngCount = files.filter(f => f.endsWith('.png')).length;
  const txtCount = files.filter(f => f.endsWith('.txt')).length;
  console.log(`\n✓ Created ${pngCount} screenshots and ${txtCount} narration files in ${screenshotDir}`);
}

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
  const filePath = path.join(screenshotDir, `${String(step).padStart(3, '0')}-narration.txt`);
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf-8') === narrationText) {
    return;
  }
  fs.writeFileSync(filePath, narrationText);
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
 * Bulk-inserts text into an element for demo recordings.
 *
 * @param mainWindow - The Playwright Page object
 * @param text - The text to insert
 * @param showHighlight - Whether to show visual highlight around the editor
 * @param focusTarget - Optional locator to focus before inserting text
 *
 * @example
 * await insertTextForDemo(mainWindow, mermaidContent, true);
 * await insertTextForDemo(mainWindow, 'my-file', true, filenameInput);
 */
export async function insertTextForDemo(
  mainWindow: Page,
  text: string,
  showHighlight: boolean,
  focusTarget?: Locator,
): Promise<void> {
  if (focusTarget) {
    await focusTarget.focus();

    // we have to select all, so that when we past it overwrites, because our system
    // is designed to write the entire content in one go, rather than character by character.
    await mainWindow.keyboard.press('Control+a');
  }
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

/**
 * Ensures a checkbox or radio button is in the specified checked state for demo recordings.
 * Highlights the element with a red border, then clicks it only if its current state
 * differs from the desired state. Works identically for both checkboxes and radio buttons.
 *
 * Note: unchecking a radio button via this function is a no-op if clicking it cannot
 * deselect it (standard HTML radio behaviour). Use it to turn radio buttons *on*.
 *
 * @param locator - The checkbox or radio button element
 * @param shouldBeChecked - true to ensure the element ends up checked, false to ensure unchecked
 *
 * @example
 * await setCheckboxForDemo(includeSubfolders, true);   // ensure checked
 * await setCheckboxForDemo(includeSubfolders, false);  // ensure unchecked
 * await setCheckboxForDemo(radioOption, true);         // select a radio button
 */
export async function setCheckboxForDemo(
  locator: Locator,
  shouldBeChecked: boolean
): Promise<void> {
  const page = locator.page();

  // Highlight the element so the action is visually obvious in the recording
  await highlightElement(page, locator, 1000);

  const isCurrentlyChecked = await locator.isChecked();
  if (isCurrentlyChecked !== shouldBeChecked) {
    await locator.click();
  }

  await page.waitForTimeout(700);
}
