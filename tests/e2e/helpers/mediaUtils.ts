import * as fs from 'fs';
import * as path from 'path';
import type { Page, Locator } from '@playwright/test';
import { screenshotWithHighlight, insertText, highlightElement } from './visual-indicators';

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

export function cleanupTestDataFiles(): void {
  const testDataDir = path.resolve(path.join(__dirname, '../../../mkbrowser-test'));
  console.log('testDataDir:', testDataDir);
  cleanupTestDataFilesRecursive(testDataDir);
}

function cleanupTestDataFilesRecursive(dir: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'A' || entry.name === 'H') {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        cleanupTestDataFilesRecursive(fullPath);
      }
    } else if (/^my-.*\.md$/.test(entry.name) || entry.name === 'AI.md' || entry.name === 'HUMAN.md') {
      fs.unlinkSync(fullPath);
    }
  }
}

/**
 * Cleans up screenshot files in a directory, preserving any subdirectories.
 * Creates the directory if it does not yet exist.
 *
 * @param screenshotDir - Directory to clean screenshot files from
 *
 * @example
 * cleanupScreenshots(screenshotDir);
 */
export function cleanupScreenshots(screenshotDir: string): void {
  if (fs.existsSync(screenshotDir)) {
    for (const entry of fs.readdirSync(screenshotDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        fs.unlinkSync(path.join(screenshotDir, entry.name));
      } else if (entry.isDirectory() && entry.name !== 'external') {
        fs.rmSync(path.join(screenshotDir, entry.name), { recursive: true });
      }
    }
  } else {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
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
 * writeNarration(screenshotDir, step++, `Welcome to MkBrowser...`);
 */
export function writeNarration(
  screenshotDir: string,
  step: number,
  narrationText: string
): void {
  const filePath = path.join(screenshotDir, `${String(step).padStart(3, '0')}-narration.txt`);
  fs.writeFileSync(filePath, narrationText);
}

/**
 * Copies an existing file from screenshotDir/<fileName> to screenshotDir/<step>-<filename> 
 * 
 * @param screenshotDir 
 * @param step 
 * @param fileName
 */
export function addExternalFile(
  screenshotDir: string,
  step: number,
  fileName: string
): void {
  const srcPath = path.join(screenshotDir, fileName);
  const baseName = path.basename(fileName);
  const destPath = path.join(screenshotDir, `${String(step).padStart(3, '0')}-${baseName}`);
  fs.copyFileSync(srcPath, destPath);
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
 * Locates the action bar for a specific file by name.
 *
 * Strategy: find the text node for `fileName`, walk up to the nearest
 * `[data-testid="browser-entry-markdown"]` ancestor, then find the
 * `[data-testid="entry-action-bar"]` inside it.
 *
 * @param scope - The Page or Locator to search within (e.g. mainContent)
 * @param fileName - The exact filename text visible in the entry header
 * @returns A Locator for the entry-action-bar of the matching file
 *
 * @example
 * const actionBar = findActionBarByFileName(mainContent, 'USER_GUIDE.md');
 * await actionBar.getByTestId('entry-reveal-button').click({ force: true });
 */
export function findActionBarByFileName(scope: Page | Locator, fileName: string): Locator {
  const page = 'page' in scope ? (scope as Locator).page() : (scope as Page);
  const markdownEntry = page
    .getByTestId('browser-entry-markdown')
    .filter({ has: page.locator(`text="${fileName}"`) })
    .first();
  return markdownEntry.getByTestId('entry-action-bar');
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
  locator: Locator,
  options?: Parameters<Locator['click']>[0]
): Promise<void> {
  await locator.page().waitForTimeout(300);
  await locator.click(options);
  await locator.page().waitForTimeout(1000);
}

/**
 * Demonstrates a right-click with standard demo timing for video recording.
 * Adds pauses before and after the click for visual clarity in demos.
 *
 * @param locator - The element to right-click
 *
 * @example
 * await demonstrateRightClickForDemo(fileNode);
 */
export async function demonstrateRightClickForDemo(
  locator: Locator
): Promise<void> {
  await locator.page().waitForTimeout(300);
  await locator.click({ button: 'right' });
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

  // Highlight the parent <label> if one exists, so the outline encompasses both
  // the checkbox/radio indicator and the label text. Fall back to the input itself.
  const parentLabel = locator.locator('xpath=ancestor::label[1]');
  const highlightTarget = (await parentLabel.count()) > 0 ? parentLabel : locator;
  await highlightElement(page, highlightTarget, 1000);

  const isCurrentlyChecked = await locator.isChecked();
  if (isCurrentlyChecked !== shouldBeChecked) {
    await locator.click();
  }

  await page.waitForTimeout(700);
}
