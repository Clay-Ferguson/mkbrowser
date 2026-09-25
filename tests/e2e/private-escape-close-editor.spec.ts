import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot,
  demoClick,
  logScreenshotSummary,
  cleanupScreenshots,
  cleanupTestDataFiles,
  resetSettings,
} from './helpers/mediaUtils';

/**
 * Private E2E Test: the global Escape handler (App.tsx) that closes an
 * unmodified editor.
 *
 *   1. Esc that dismisses a dialog opened from the editor (Calendar Info) closes
 *      only the dialog — the editor stays open.
 *   2. For a file with a generated TOC, Esc outside CodeMirror still closes the
 *      unmodified editor: "unmodified" compares against the TOC-stripped content
 *      the buffer was seeded with (isEditUnmodified), not the raw file.
 *
 * This test is private (not part of the demo video set); its purpose is
 * automated verification.
 */
test.describe('Private: Escape closes editor', () => {
  test('Esc dismissing a dialog keeps the editor; Esc closes an unmodified TOC file', async ({ mainWindow, testDataPath }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    const folderName = 'my-escape-folder';
    const folderPath = path.join(testDataPath, folderName);
    // Phase 1 needs a file WITHOUT a TOC: the old handler never saw a TOC file as
    // unmodified, which would mask the dialog bug.
    const plainFileName = 'my-escape-plain.md';
    const tocFileName = 'my-escape-toc.md';
    fs.rmSync(folderPath, { recursive: true, force: true });
    fs.mkdirSync(folderPath, { recursive: true });
    fs.writeFileSync(path.join(folderPath, plainFileName), `# Escape Plain\n\nNo TOC here.\n`);
    fs.writeFileSync(
      path.join(folderPath, tocFileName),
      `# Escape Target\n\n<!-- TOC -->\n- [Section](#section)\n<!-- /TOC -->\n\n## Section\n\nBody text.\n`
    );

    let step = 1;
    await mainWindow.waitForTimeout(2000);

    const listing = mainWindow.getByTestId('browser-main-content');
    const saveButton = mainWindow.getByTestId('entry-save-button');
    const openDialog = mainWindow.locator('dialog[open]');

    await demoClick(mainWindow.getByTestId('refresh-button'));
    await demoClick(listing.getByText(folderName, { exact: true }));
    await expect(listing.getByText(tocFileName, { exact: true })).toBeVisible({ timeout: 10000 });

    const entryFor = (name: string) => listing
      .getByTestId('browser-entry-markdown')
      .filter({ has: mainWindow.locator(`text="${name}"`) })
      .first();

    // --- Phase 1: Esc on a dialog closes only the dialog --------------------
    await demoClick(entryFor(plainFileName).getByRole('heading', { name: 'Escape Plain' }));
    await expect(saveButton).toBeVisible({ timeout: 10000 });

    await demoClick(mainWindow.getByTestId('edit-calendar-info'));
    await expect(openDialog).toHaveCount(1, { timeout: 5000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'calendar-dialog-open');

    await mainWindow.keyboard.press('Escape');
    await expect(openDialog).toHaveCount(0, { timeout: 5000 });
    // Give any stray handler a moment to act before asserting the editor survived.
    await mainWindow.waitForTimeout(500);
    await expect(saveButton).toBeVisible();
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'dialog-closed-editor-open');

    // Leave the plain file's editor via Cancel before editing the next file.
    await demoClick(mainWindow.getByTestId('entry-cancel-button'));
    await expect(saveButton).toHaveCount(0, { timeout: 5000 });

    // --- Phase 2: Esc outside CodeMirror closes the unmodified TOC file -----
    await demoClick(entryFor(tocFileName).getByRole('heading', { name: 'Escape Target' }));
    await expect(saveButton).toBeVisible({ timeout: 10000 });
    // Blur the editor so the key reaches only the document-level handler.
    await mainWindow.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await mainWindow.keyboard.press('Escape');
    await expect(saveButton).toHaveCount(0, { timeout: 5000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'editor-closed');

    // Nothing was written: the file still holds its full TOC.
    expect(fs.readFileSync(path.join(folderPath, tocFileName), 'utf8')).toContain('- [Section](#section)');

    logScreenshotSummary(screenshotDir);
  });
});
