import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot,
  writeNarration,
  demoClick,
  setCheckbox,
  logScreenshotSummary,
  cleanupScreenshots,
  cleanupTestDataFiles,
  resetSettings,
  findActionBarByFileName,
} from './helpers/mediaUtils';

/**
 * Private E2E Test: Cut and Paste
 *
 * Exercises the multi-select cut/paste workflow:
 *   1. Seeds three markdown files and an empty destination folder on disk.
 *   2. Selects two of the files with their selection checkboxes.
 *   3. Cuts them with the header Cut button (they disappear from the list).
 *   4. Pastes them into the destination folder via the folder row's paste button.
 *   5. Verifies the move both in the UI (navigating into the folder) and on disk.
 *   6. Selects both pasted files and deletes them with the header Delete button.
 *   7. Navigates back up with the Up Level button and deletes the remaining
 *      seeded file using the delete icon on its entry header (no checkboxes).
 *
 * This test is private (not part of the demo video set) — it still writes
 * screenshots/narration to follow the shared conventions, but its primary
 * purpose is automated verification of the cut/paste feature.
 */
test.describe('Private: Cut and Paste', () => {
  test('cut two files and paste them into another folder', async ({ mainWindow, testDataPath }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // Seed the working files. cleanupTestDataFiles() removes my-*.md files
    // recursively (including ones a previous run pasted into the destination
    // folder), but not the destination folder itself — so remove and recreate
    // it here for a clean slate.
    const destFolderName = 'my-paste-target';
    const destFolderPath = path.join(testDataPath, destFolderName);
    fs.rmSync(destFolderPath, { recursive: true, force: true });
    fs.mkdirSync(destFolderPath);

    const cutFiles = ['my-cut-note-alpha.md', 'my-cut-note-bravo.md'];
    const stayFile = 'my-stay-note-charlie.md';
    for (const file of [...cutFiles, stayFile]) {
      fs.writeFileSync(
        path.join(testDataPath, file),
        `# ${file}\n\nContent for ${file} used by the cut and paste test.\n`
      );
    }

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // The files were written to disk after the app started reading the folder,
    // so refresh to make sure they are all visible.
    await demoClick(mainWindow.getByTestId('refresh-button'));

    const mainContent = mainWindow.getByTestId('browser-main-content');
    for (const file of [...cutFiles, stayFile]) {
      await expect(mainContent.getByText(file).first()).toBeVisible({ timeout: 10000 });
    }
    await expect(mainContent.getByText(destFolderName, { exact: true })).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-files-visible');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. Today we're looking at cutting and pasting files, which lets you move files from one folder into another.
Here we have three markdown files and an empty destination folder — we'll select two of the files, cut them, and paste them into the folder.`
    );

    // Select the two files to cut using their selection checkboxes.
    for (const file of cutFiles) {
      const checkbox = mainContent.getByRole('checkbox', { name: `Select ${file}` });
      await setCheckbox(checkbox, true);
    }

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'two-files-selected');
    writeNarration(
      screenshotDir,
      step++,
      `Both files are now selected.
Notice the Cut and Delete buttons that appeared in the header now that items are selected.`
    );

    // Cut the selected files. The Cut button only appears while items are
    // selected and nothing is cut yet.
    const cutButton = mainWindow.getByTestId('cut-button');
    await expect(cutButton).toBeVisible();
    await takeScreenshot(mainWindow, cutButton, screenshotDir, step++, 'about-to-cut');
    writeNarration(
      screenshotDir,
      step++,
      `We click the Cut button to cut the selected files.`
    );

    await demoClick(cutButton);

    // Cut items are hidden from the browse list until they are pasted.
    for (const file of cutFiles) {
      await expect(mainContent.getByText(file)).not.toBeVisible({ timeout: 5000 });
    }
    // The unselected file is unaffected.
    await expect(mainContent.getByText(stayFile).first()).toBeVisible();
    // With items cut (and none selected), the Cut button goes away again.
    await expect(cutButton).not.toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'files-cut');
    writeNarration(
      screenshotDir,
      step++,
      `The two cut files have disappeared from the list, while the third file remains.
Every folder in the list now shows a paste button, letting us choose where the cut items go.`
    );

    // Paste into the destination folder via the paste button on its row.
    const destFolderRow = mainContent
      .locator('div.group')
      .filter({ hasText: destFolderName });
    const pasteButton = destFolderRow.getByRole('button', {
      name: 'Paste cut items into this folder',
    });
    await expect(pasteButton).toBeVisible();
    await takeScreenshot(mainWindow, pasteButton, screenshotDir, step++, 'about-to-paste');
    writeNarration(
      screenshotDir,
      step++,
      `We click the paste button on the destination folder to move the cut files into it.`
    );

    await demoClick(pasteButton);

    // Verify the move on disk: both cut files now live in the destination
    // folder and are gone from the source folder; the third file stayed put.
    await expect(async () => {
      for (const file of cutFiles) {
        expect(fs.existsSync(path.join(destFolderPath, file))).toBe(true);
        expect(fs.existsSync(path.join(testDataPath, file))).toBe(false);
      }
    }).toPass({ timeout: 10000 });
    expect(fs.existsSync(path.join(testDataPath, stayFile))).toBe(true);

    // After pasting, all paste buttons disappear (nothing is cut anymore).
    await expect(
      mainContent.getByRole('button', { name: 'Paste cut items into this folder' })
    ).toHaveCount(0);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'after-paste');
    writeNarration(
      screenshotDir,
      step++,
      `The paste is complete and the paste buttons are gone.
Now let's open the destination folder to confirm the files arrived.`
    );

    // Navigate into the destination folder and confirm both files render there.
    await demoClick(mainContent.getByText(destFolderName, { exact: true }));

    for (const file of cutFiles) {
      await expect(mainContent.getByText(file).first()).toBeVisible({ timeout: 10000 });
    }
    // The file that was not cut did not come along.
    await expect(mainContent.getByText(stayFile)).not.toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'files-in-destination');
    writeNarration(
      screenshotDir,
      step++,
      `Inside the destination folder we can see both files that we cut and pasted.
The cut and paste workflow moved exactly the files we selected, and nothing else.
Next, let's clean up by deleting these two files.`
    );

    // Select both pasted files and delete them with the header Delete button.
    for (const file of cutFiles) {
      const checkbox = mainContent.getByRole('checkbox', { name: `Select ${file}` });
      await setCheckbox(checkbox, true);
    }

    const deleteButton = mainWindow.getByTestId('delete-button');
    await expect(deleteButton).toBeVisible();
    await takeScreenshot(mainWindow, deleteButton, screenshotDir, step++, 'about-to-delete-selected');
    writeNarration(
      screenshotDir,
      step++,
      `With both files selected again, we click the Delete button in the header to remove them.`
    );

    await demoClick(deleteButton);

    // Confirm the "Move N selected item(s) to trash?" dialog.
    const confirmButton = mainWindow.getByTestId('confirm-dialog-confirm-button');
    await expect(confirmButton).toBeVisible();
    await takeScreenshot(mainWindow, confirmButton, screenshotDir, step++, 'confirm-delete-selected');
    writeNarration(
      screenshotDir,
      step++,
      `A confirmation dialog asks if we want to move the selected items to the trash.
We confirm the deletion.`
    );

    await demoClick(confirmButton);

    // Both files are gone from the rendered page and from disk.
    for (const file of cutFiles) {
      await expect(mainContent.getByText(file)).toHaveCount(0, { timeout: 10000 });
    }
    await expect(async () => {
      for (const file of cutFiles) {
        expect(fs.existsSync(path.join(destFolderPath, file))).toBe(false);
      }
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'files-deleted');
    writeNarration(
      screenshotDir,
      step++,
      `Both files have been deleted and the folder is empty again.
Now we'll head back up to the folder where we started.`
    );

    // Navigate back up to the starting folder with the Up Level button.
    const upLevelButton = mainWindow.getByTestId('navigate-up-button');
    await expect(upLevelButton).toBeVisible();
    await takeScreenshot(mainWindow, upLevelButton, screenshotDir, step++, 'about-to-go-up');
    writeNarration(
      screenshotDir,
      step++,
      `We click the Up Level button to return to the parent folder.`
    );

    await demoClick(upLevelButton);

    // The file we never cut is still sitting here.
    await expect(mainContent.getByText(stayFile).first()).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'back-at-start');
    writeNarration(
      screenshotDir,
      step++,
      `We're back in the starting folder, where the file we never moved is still waiting.
This time, instead of using the selection checkboxes, we'll delete it with the trash icon right on the file's own header.`
    );

    // Delete the leftover file via the delete icon on its entry header. The
    // action bar is revealed on hover, so hover the entry first and force the
    // click in case the reveal transition hasn't finished.
    const stayFileActionBar = findActionBarByFileName(mainContent, stayFile);
    await stayFileActionBar.hover();
    const entryDeleteButton = stayFileActionBar.getByTestId('entry-delete-button');
    await takeScreenshot(mainWindow, entryDeleteButton, screenshotDir, step++, 'about-to-delete-via-header');
    writeNarration(
      screenshotDir,
      step++,
      `We click the trash icon in the file's header action bar.`
    );

    await demoClick(entryDeleteButton, { force: true });

    // Confirm the per-file delete dialog.
    const entryConfirmButton = mainWindow.getByTestId('confirm-dialog-confirm-button');
    await expect(entryConfirmButton).toBeVisible();
    await demoClick(entryConfirmButton);

    // The last seeded file is gone from the page and from disk.
    await expect(mainContent.getByText(stayFile)).toHaveCount(0, { timeout: 10000 });
    await expect(async () => {
      expect(fs.existsSync(path.join(testDataPath, stayFile))).toBe(false);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'all-cleaned-up');
    writeNarration(
      screenshotDir,
      step++,
      `The last file is gone, so everything this test created has now been cut, pasted, and deleted.
That completes the cut, paste, and delete workflow.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
