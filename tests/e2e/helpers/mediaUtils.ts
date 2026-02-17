import type { Page } from '@playwright/test';
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
