import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot,
  writeNarration,
  demoClick,
  logScreenshotSummary,
  cleanupScreenshots,
  cleanupTestDataFiles,
  resetSettings,
} from './helpers/mediaUtils';

/**
 * Private E2E Test: Replace in Files
 *
 * Exercises the Edit menu > Replace in Files feature — a recursive,
 * case-sensitive, literal find-and-replace across all .md and .txt files in the
 * current folder and its subfolders:
 *   1. Seeds a dedicated subfolder with three markdown files (one in a nested
 *      subfolder) containing the token "Widget", plus a lowercase "widget" that
 *      must survive as the case-sensitivity control.
 *   2. Navigates into the folder and opens Edit menu > Replace in Files.
 *   3. Replaces "Widget" with "Gadget", verifying the summary reports 4
 *      replacements across 3 files.
 *   4. Verifies on disk that every "Widget" became "Gadget" (recursing into the
 *      subfolder) while the lowercase "widget" was left untouched.
 *
 * This test is private (not part of the demo video set) — it still writes
 * screenshots/narration to follow the shared conventions, but its primary
 * purpose is automated verification of the Replace in Files feature.
 */
test.describe('Private: Replace in Files', () => {
  test('recursively replace a token across files, case-sensitively', async ({ mainWindow, testDataPath }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // Seed a dedicated subfolder. cleanupTestDataFiles() removes my-*.md files
    // recursively but not the folders themselves, so remove and recreate the
    // demo folder here for a clean slate.
    const demoFolderName = 'my-replace-demo';
    const demoFolderPath = path.join(testDataPath, demoFolderName);
    fs.rmSync(demoFolderPath, { recursive: true, force: true });
    fs.mkdirSync(demoFolderPath);
    const subFolderPath = path.join(demoFolderPath, 'sub');
    fs.mkdirSync(subFolderPath);

    // my-replace-a.md — "Widget" twice, proving all occurrences per file replace.
    const fileA = 'my-replace-a.md';
    fs.writeFileSync(
      path.join(demoFolderPath, fileA),
      `# ${fileA}\n\nThe first Widget sits on the shelf.\n\nA second Widget hums quietly nearby.\n`
    );

    // my-replace-b.md — one "Widget" plus a lowercase "widget" control that
    // case-sensitive replace must leave alone.
    const fileB = 'my-replace-b.md';
    fs.writeFileSync(
      path.join(demoFolderPath, fileB),
      `# ${fileB}\n\nHere is a capital Widget in a sentence.\n\nAnd here is a lowercase widget that should survive.\n`
    );

    // sub/my-replace-c.md — one "Widget", proving the replace recurses.
    const fileC = 'my-replace-c.md';
    fs.writeFileSync(
      path.join(subFolderPath, fileC),
      `# ${fileC}\n\nA lonely Widget waits down in the subfolder.\n`
    );

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // The folder was written to disk after the app started reading the
    // directory, so refresh to make sure it shows up.
    await demoClick(mainWindow.getByTestId('refresh-button'));

    const mainContent = mainWindow.getByTestId('browser-main-content');
    await expect(mainContent.getByText(demoFolderName, { exact: true })).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser.
Today we're going to look at Replace in Files, which finds and replaces text across every markdown and text file in a folder and its subfolders.
Let's open this folder to see what we're working with.`
    );

    // Navigate into the demo folder and confirm its contents are visible.
    await demoClick(mainContent.getByText(demoFolderName, { exact: true }));

    await expect(mainContent.getByText(fileA).first()).toBeVisible({ timeout: 10000 });
    await expect(mainContent.getByText(fileB).first()).toBeVisible();
    await expect(mainContent.getByText('sub', { exact: true })).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'folder-contents');
    writeNarration(
      screenshotDir,
      step++,
      `Inside the folder are two markdown files and a subfolder named "sub", which holds a third file.
Each of these files mentions the word "Widget", and we're going to rename that product to "Gadget" everywhere at once.`
    );

    // Open the Edit menu, which is where Replace in Files lives.
    const editMenuButton = mainWindow.getByTestId('edit-menu-button');
    await takeScreenshot(mainWindow, editMenuButton, screenshotDir, step++, 'about-to-open-edit-menu');
    writeNarration(
      screenshotDir,
      step++,
      `Replace in Files lives in the Edit menu, so we click the Edit menu button in the toolbar.`
    );

    await demoClick(editMenuButton);

    const replaceMenuItem = mainWindow.getByRole('button', { name: 'Replace in Files', exact: true });
    await expect(replaceMenuItem).toBeVisible();
    await takeScreenshot(mainWindow, replaceMenuItem, screenshotDir, step++, 'about-to-click-replace-in-files');
    writeNarration(
      screenshotDir,
      step++,
      `The Edit menu is open, and we can see the Replace in Files option.
We'll click it to open the find-and-replace dialog.`
    );

    await demoClick(replaceMenuItem);

    // The dialog inputs should now be present.
    const searchInput = mainWindow.getByTestId('replace-search-input');
    const replaceInput = mainWindow.getByTestId('replace-text-input');
    await expect(searchInput).toBeVisible();
    await expect(replaceInput).toBeVisible();

    // Fill in the search and replacement tokens.
    await searchInput.fill('Widget');
    await replaceInput.fill('Gadget');

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'dialog-filled');
    writeNarration(
      screenshotDir,
      step++,
      `We type "Widget" as the text to find and "Gadget" as the replacement.
This scans the current folder and all of its subfolders, and the match is case-sensitive — so a lowercase "widget" will be left exactly as it is.`
    );

    // Execute the replace.
    const submitButton = mainWindow.getByTestId('replace-dialog-submit-button');
    await takeScreenshot(mainWindow, submitButton, screenshotDir, step++, 'about-to-submit');
    writeNarration(
      screenshotDir,
      step++,
      `We click Replace to run the operation across all the files at once.`
    );

    await demoClick(submitButton);

    // A summary alert reports how many replacements were made across how many
    // files: 4 occurrences (two in file A, one each in files B and C) in 3 files.
    const okButton = mainWindow.getByTestId('alert-dialog-ok-button');
    await expect(okButton).toBeVisible({ timeout: 10000 });
    // The alert dialog renders outside browser-main-content, so search the whole
    // window. The summary sentence ends with a period on screen.
    await expect(mainWindow.getByText('Replaced 4 occurrences in 3 files.')).toBeVisible();

    await takeScreenshot(mainWindow, okButton, screenshotDir, step++, 'results-summary');
    writeNarration(
      screenshotDir,
      step++,
      `A summary dialog confirms the result: 4 occurrences were replaced across 3 files.
That's two in the first file, one in the second, and one in the file tucked away in the subfolder.
We dismiss the dialog to continue.`
    );

    await demoClick(okButton);

    // The rendered markdown of expanded files may not auto-refresh, so refresh
    // to pull in the updated content, then do a modest UI check. The
    // authoritative verification is against disk below.
    await demoClick(mainWindow.getByTestId('refresh-button'));

    await expect(mainContent.getByText('Gadget').first()).toBeVisible({ timeout: 10000 });
    // A case-sensitive regex: no capital-W "Widget" survives anywhere on screen
    // (the lowercase "widget" control is not matched by this pattern).
    await expect(mainContent.getByText(/Widget/)).toHaveCount(0);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'after-replace-ui');
    writeNarration(
      screenshotDir,
      step++,
      `Back in the browser, every "Widget" now reads "Gadget".
The replacement reached into the subfolder too, and the case-sensitive lowercase "widget" was left untouched.`
    );

    // Verify on disk: this is the authoritative check.
    await expect(async () => {
      const contentA = fs.readFileSync(path.join(demoFolderPath, fileA), 'utf-8');
      // Both occurrences in file A were replaced; no capital Widget remains.
      expect((contentA.match(/Gadget/g) || []).length).toBe(2);
      expect(contentA).not.toContain('Widget');

      const contentB = fs.readFileSync(path.join(demoFolderPath, fileB), 'utf-8');
      // File B: the capital Widget became Gadget, but the lowercase widget
      // survived — this proves the replace is case-sensitive.
      expect((contentB.match(/Gadget/g) || []).length).toBe(1);
      expect(contentB).not.toContain('Widget');
      expect(contentB).toContain('widget');

      const contentC = fs.readFileSync(path.join(subFolderPath, fileC), 'utf-8');
      // File C lives in the subfolder — proving the replace recursed.
      expect(contentC).toContain('Gadget');
      expect(contentC).not.toContain('Widget');
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'verified-on-disk');
    writeNarration(
      screenshotDir,
      step++,
      `Checking the files on disk confirms everything.
The subfolder's file was updated too, so the operation truly recurses, and the lowercase "widget" is still there — case-sensitivity working exactly as documented.
Replace in Files makes sweeping renames across a whole folder tree quick and safe.`
    );

    // Cleanup: remove the demo folder and everything inside it.
    fs.rmSync(demoFolderPath, { recursive: true, force: true });

    logScreenshotSummary(screenshotDir);
  });
});
