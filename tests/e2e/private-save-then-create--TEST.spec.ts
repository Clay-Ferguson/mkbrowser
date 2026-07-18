import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot,
  demoClick,
  insertText,
  logScreenshotSummary,
  cleanupScreenshots,
  cleanupTestDataFiles,
  resetSettings,
} from './helpers/mediaUtils';

/**
 * Private E2E Test: saved content survives creating another file
 *
 * Regression test for the blank-content bug: the atomic save (temp file +
 * rename) gives a file a new inode, so its birthtime changes on every save.
 * The store's isReplacedFile heuristic read that unknown birthtime as "the
 * file was replaced behind our back" and wiped the item — including its
 * cached content — on the next directory refresh. Creating a new file always
 * triggers that refresh, so every file saved since launch went blank the
 * moment another file was created, and stayed blank (the content loader's
 * effect deps never changed) until an app restart.
 *
 * The fix is two-part: the save flow adopts the post-write birthtime into the
 * item's createdTime, and the content loader re-fetches whenever the cached
 * content becomes invalid rather than only when the mtime changes.
 *
 * Flow:
 *   1. Create file one, type content, save — content renders.
 *   2. Create file two — file one's rendered content must STILL be visible
 *      (this is the exact moment the regression blanked it).
 *   3. Type content into file two, save — both contents visible.
 *   4. Click the refresh button — both contents still visible.
 *   5. Replace file one on disk via an external atomic rename that keeps the
 *      mtime unchanged (birthtime changes, mtime doesn't — the one shape of
 *      invalidation the old content loader could never recover from), then
 *      refresh — the new content must render instead of a permanent blank.
 */
test.describe('Private: saved content survives creating another file', () => {
  test('save, create another file, save, refresh — nothing goes blank', async ({ mainWindow, testDataPath }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    let step = 1;
    const mainContent = mainWindow.getByTestId('browser-main-content');

    // Wait for the initial directory load.
    await expect(mainContent.getByText('sample.md').first()).toBeVisible({ timeout: 10000 });

    // Creates a file via the Create File dialog and waits for its editor.
    const createFile = async (name: string) => {
      await demoClick(mainWindow.getByTestId('create-file-button'));
      await insertText(mainWindow, name, true, mainWindow.getByTestId('create-file-dialog-input'));
      await demoClick(mainWindow.getByTestId('create-file-dialog-create-button'));
      await expect(mainWindow.locator('.cm-editor').first()).toBeVisible({ timeout: 10000 });
    };

    // Types into the open editor and saves, waiting for the editor to close.
    const typeAndSave = async (content: string) => {
      await insertText(mainWindow, content, true);
      await demoClick(mainWindow.getByTestId('entry-save-button'));
      await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });
    };

    const contentOne = 'alpha content survives';
    const contentTwo = 'bravo content also survives';

    // --- 1. Create file one, type, save; content renders --------------------
    await createFile('my-survivor-one');
    await typeAndSave(contentOne);
    await expect(mainContent.getByText(contentOne)).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'first-file-saved');

    // --- 2. Create file two; file one's content must still render -----------
    // The regression fired exactly here: the create triggers a directory
    // refresh, the refresh sees file one's post-save birthtime, and the store
    // wiped file one's content while the new file's editor opened.
    await createFile('my-survivor-two');
    await expect(mainContent.getByText(contentOne)).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'second-editor-open-first-content-intact');

    // --- 3. Save file two; both contents render ------------------------------
    await typeAndSave(contentTwo);
    await expect(mainContent.getByText(contentOne)).toBeVisible({ timeout: 5000 });
    await expect(mainContent.getByText(contentTwo)).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'both-files-saved-and-rendered');

    // --- 4. Refresh; both contents still render ------------------------------
    await demoClick(mainWindow.getByTestId('refresh-button'));
    await expect(mainContent.getByText(contentOne)).toBeVisible({ timeout: 5000 });
    await expect(mainContent.getByText(contentTwo)).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'after-refresh-still-rendered');

    // --- 5. External same-mtime atomic replace; refresh shows new content ----
    // An editor-style atomic save (temp file + rename) from outside the app,
    // with the mtime pinned to the old value: the store sees a new birthtime
    // (entry wiped as replaced) but no mtime change. Only the cache-validity
    // effect dependency in useContentLoader makes the loader re-read here; an
    // mtime-based dependency leaves the entry blank until app restart.
    const externalContent = 'charlie externally replaced';
    const filePath = path.join(testDataPath, 'my-survivor-one.md');
    const { mtime } = fs.statSync(filePath);
    const tmpPath = path.join(testDataPath, '.my-survivor-one.md.external.tmp');
    fs.writeFileSync(tmpPath, externalContent);
    fs.utimesSync(tmpPath, mtime, mtime);
    fs.renameSync(tmpPath, filePath);

    await demoClick(mainWindow.getByTestId('refresh-button'));
    await expect(mainContent.getByText(externalContent)).toBeVisible({ timeout: 5000 });
    await expect(mainContent.getByText(contentTwo)).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'external-replace-rerendered');

    logScreenshotSummary(screenshotDir);
  });
});
