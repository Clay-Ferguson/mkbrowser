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
} from './helpers/mediaUtils';

/**
 * Private E2E Test: Select All, Unselect All, and Undo Cut
 *
 * Exercises the selection-management items in the Edit popup menu, plus the
 * cut-cancellation safety net:
 *   1. Seeds a dedicated subfolder with three markdown files and an empty
 *      destination folder on disk.
 *   2. Confirms Undo Cut starts disabled (nothing has been cut yet).
 *   3. Select All — every file checkbox and the destination folder checkbox
 *      become checked, and the header Cut/Delete buttons appear.
 *   4. Unselect All — every checkbox clears and the header buttons disappear.
 *   5. Cuts two files (they vanish from the list and every folder shows a paste
 *      button), then uses Undo Cut to bring them back.
 *   6. Proves the negative: after cut + undo, nothing moved on disk — all three
 *      files are still in the source folder and the destination folder is empty.
 *   7. Confirms Undo Cut is disabled again once the cut has been undone.
 *
 * This test is private (not part of the demo video set) — it still writes
 * screenshots/narration to follow the shared conventions, but its primary
 * purpose is automated verification of the selection/undo-cut features.
 */
test.describe('Private: Select All, Unselect All, and Undo Cut', () => {
  test('select all, unselect all, and undo a pending cut with no disk changes', async ({ mainWindow, testDataPath }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // Seed a dedicated subfolder with three files and an empty destination
    // folder. cleanupTestDataFiles() removes my-*.md files recursively but not
    // folders, so remove and recreate the subfolder here for a clean slate.
    const demoFolderName = 'my-undo-cut-demo';
    const demoFolderPath = path.join(testDataPath, demoFolderName);
    fs.rmSync(demoFolderPath, { recursive: true, force: true });
    fs.mkdirSync(demoFolderPath);

    const destFolderName = 'dest';
    const destPath = path.join(demoFolderPath, destFolderName);
    fs.mkdirSync(destPath);

    const seedFiles = ['my-item-one.md', 'my-item-two.md', 'my-item-three.md'];
    for (const file of seedFiles) {
      fs.writeFileSync(
        path.join(demoFolderPath, file),
        `# ${file}\n\nContent for ${file} used by the select-all / undo-cut test.\n`
      );
    }

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // The folder was written to disk after the app started reading the
    // directory, so refresh to make sure it shows up.
    await demoClick(mainWindow.getByTestId('refresh-button'));

    const mainContent = mainWindow.getByTestId('browser-main-content');
    await expect(mainContent.getByText(demoFolderName, { exact: true })).toBeVisible({ timeout: 10000 });

    // Navigate into the demo folder so only our seeded items are on screen.
    await demoClick(mainContent.getByText(demoFolderName, { exact: true }));

    for (const file of seedFiles) {
      await expect(mainContent.getByText(file).first()).toBeVisible({ timeout: 10000 });
    }
    await expect(mainContent.getByText(destFolderName, { exact: true })).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. Today we'll explore the selection tools in the Edit menu — Select All and Unselect All — and the Undo Cut safety net that cancels a pending move.
Here is our folder, holding three markdown files and an empty destination folder called "dest".`
    );

    const editMenuButton = mainWindow.getByTestId('edit-menu-button');

    // --- Step: Undo Cut starts disabled ---------------------------------
    await takeScreenshot(mainWindow, editMenuButton, screenshotDir, step++, 'about-to-open-edit-menu-initial');
    writeNarration(
      screenshotDir,
      step++,
      `Let's open the Edit menu to take a look.`
    );

    await demoClick(editMenuButton);

    // Disabled menu items render as a real <button disabled> (PopupMenuItem),
    // so toBeDisabled() is the right assertion.
    const undoCutItem = mainWindow.getByRole('button', { name: 'Undo Cut', exact: true });
    await expect(undoCutItem).toBeVisible();
    await expect(undoCutItem).toBeDisabled();

    await takeScreenshot(mainWindow, undoCutItem, screenshotDir, step++, 'undo-cut-disabled-initially');
    writeNarration(
      screenshotDir,
      step++,
      `At the top of the menu is Undo Cut. Because nothing has been cut yet, it is grayed out and can't be clicked.
It only comes to life once we've cut something and might want to change our minds.`
    );

    // Close the menu without triggering an action (Escape is handled by PopupMenu).
    await mainWindow.keyboard.press('Escape');
    await expect(undoCutItem).toHaveCount(0);

    // --- Step: Select All ------------------------------------------------
    await takeScreenshot(mainWindow, editMenuButton, screenshotDir, step++, 'about-to-open-edit-menu-select-all');
    writeNarration(
      screenshotDir,
      step++,
      `Next we'll reopen the Edit menu to use Select All.`
    );

    await demoClick(editMenuButton);

    const selectAllItem = mainWindow.getByRole('button', { name: 'Select All', exact: true });
    await expect(selectAllItem).toBeVisible();
    await takeScreenshot(mainWindow, selectAllItem, screenshotDir, step++, 'about-to-click-select-all');
    writeNarration(
      screenshotDir,
      step++,
      `Select All checks every item in the current folder at once — files and folders alike.
Let's click it.`
    );

    await demoClick(selectAllItem);

    // Every seeded file and the destination folder should now be checked.
    for (const file of seedFiles) {
      const checkbox = mainContent.getByRole('checkbox', { name: `Select ${file}` });
      await expect(checkbox).toBeChecked({ timeout: 10000 });
    }
    const destCheckbox = mainContent.getByRole('checkbox', { name: `Select ${destFolderName}` });
    await expect(destCheckbox).toBeChecked();

    // With items selected (and nothing cut), the header Cut/Delete buttons appear.
    const cutButton = mainWindow.getByTestId('cut-button');
    const deleteButton = mainWindow.getByTestId('delete-button');
    await expect(cutButton).toBeVisible();
    await expect(deleteButton).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'all-items-selected');
    writeNarration(
      screenshotDir,
      step++,
      `Every checkbox is now ticked — all three files plus the "dest" folder.
Because items are selected, the Cut and Delete buttons have appeared in the header, ready to act on the whole selection.`
    );

    // --- Step: Unselect All ---------------------------------------------
    await takeScreenshot(mainWindow, editMenuButton, screenshotDir, step++, 'about-to-open-edit-menu-unselect-all');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's clear that selection just as quickly. Back into the Edit menu.`
    );

    await demoClick(editMenuButton);

    const unselectAllItem = mainWindow.getByRole('button', { name: 'Unselect All', exact: true });
    await expect(unselectAllItem).toBeVisible();
    await takeScreenshot(mainWindow, unselectAllItem, screenshotDir, step++, 'about-to-click-unselect-all');
    writeNarration(
      screenshotDir,
      step++,
      `Unselect All is the mirror image of Select All — it clears every checkbox in one click.`
    );

    await demoClick(unselectAllItem);

    // Every checkbox should be cleared and the header buttons should vanish.
    for (const file of seedFiles) {
      const checkbox = mainContent.getByRole('checkbox', { name: `Select ${file}` });
      await expect(checkbox).not.toBeChecked({ timeout: 10000 });
    }
    await expect(destCheckbox).not.toBeChecked();
    await expect(cutButton).not.toBeVisible();
    await expect(deleteButton).not.toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'all-items-unselected');
    writeNarration(
      screenshotDir,
      step++,
      `Everything is deselected again, and the Cut and Delete buttons have disappeared from the header now that nothing is selected.`
    );

    // --- Step: Cut two files --------------------------------------------
    const cutFiles = ['my-item-one.md', 'my-item-two.md'];
    const stayFile = 'my-item-three.md';
    for (const file of cutFiles) {
      const checkbox = mainContent.getByRole('checkbox', { name: `Select ${file}` });
      await setCheckbox(checkbox, true);
    }

    await takeScreenshot(mainWindow, cutButton, screenshotDir, step++, 'two-files-selected-for-cut');
    writeNarration(
      screenshotDir,
      step++,
      `To set up the Undo Cut demonstration, we select two of the files and click the Cut button.`
    );

    await expect(cutButton).toBeVisible();
    await demoClick(cutButton);

    // Cut items are hidden from the list until they are pasted (or the cut is undone).
    for (const file of cutFiles) {
      await expect(mainContent.getByText(file)).not.toBeVisible({ timeout: 5000 });
    }
    await expect(mainContent.getByText(stayFile).first()).toBeVisible();

    // Every folder now offers a paste button; here that's the "dest" folder.
    const pasteButtons = mainContent.getByRole('button', { name: 'Paste cut items into this folder' });
    await expect(pasteButtons).toHaveCount(1);
    await expect(pasteButtons.first()).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'two-files-cut');
    writeNarration(
      screenshotDir,
      step++,
      `The two cut files have vanished from the list, while the third file stays put.
The "dest" folder now shows a paste button — this is the point where we would normally choose a destination. But instead, we're going to change our minds.`
    );

    // --- Step: Undo Cut --------------------------------------------------
    await takeScreenshot(mainWindow, editMenuButton, screenshotDir, step++, 'about-to-open-edit-menu-undo-cut');
    writeNarration(
      screenshotDir,
      step++,
      `We reopen the Edit menu — and this time Undo Cut is available.`
    );

    await demoClick(editMenuButton);

    const undoCutItemEnabled = mainWindow.getByRole('button', { name: 'Undo Cut', exact: true });
    await expect(undoCutItemEnabled).toBeVisible();
    await expect(undoCutItemEnabled).toBeEnabled();

    await takeScreenshot(mainWindow, undoCutItemEnabled, screenshotDir, step++, 'about-to-click-undo-cut');
    writeNarration(
      screenshotDir,
      step++,
      `Now that two files are cut, Undo Cut is enabled. Clicking it cancels the pending move and brings the hidden files right back.`
    );

    await demoClick(undoCutItemEnabled);

    // The cut files reappear and the paste buttons are gone.
    for (const file of cutFiles) {
      await expect(mainContent.getByText(file).first()).toBeVisible({ timeout: 10000 });
    }
    await expect(
      mainContent.getByRole('button', { name: 'Paste cut items into this folder' })
    ).toHaveCount(0);

    // After Undo Cut the restored items come back UNSELECTED: cutSelectedItems
    // clears isSelected while setting isCut, and clearAllCutItems only flips
    // isCut back off (see src/store/items.ts). So no checkboxes are checked and
    // the header Cut/Delete buttons stay hidden.
    for (const file of cutFiles) {
      const checkbox = mainContent.getByRole('checkbox', { name: `Select ${file}` });
      await expect(checkbox).not.toBeChecked();
    }
    await expect(cutButton).not.toBeVisible();
    await expect(deleteButton).not.toBeVisible();

    // The whole point of this test: nothing actually moved on disk. All three
    // files are still in the source folder, and the destination folder is empty.
    await expect(async () => {
      for (const file of seedFiles) {
        expect(fs.existsSync(path.join(demoFolderPath, file))).toBe(true);
      }
      expect(fs.readdirSync(destPath).length).toBe(0);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'cut-undone');
    writeNarration(
      screenshotDir,
      step++,
      `Both files are back in the list and the paste buttons are gone — the pending move has been cancelled.
Crucially, nothing ever moved on disk: all three files are still right here, and the "dest" folder is still completely empty. Undo Cut is a true safety net.`
    );

    // --- Step: Undo Cut disabled again ----------------------------------
    await takeScreenshot(mainWindow, editMenuButton, screenshotDir, step++, 'about-to-open-edit-menu-final');
    writeNarration(
      screenshotDir,
      step++,
      `One last look at the Edit menu to confirm the state has reset.`
    );

    await demoClick(editMenuButton);

    const undoCutItemFinal = mainWindow.getByRole('button', { name: 'Undo Cut', exact: true });
    await expect(undoCutItemFinal).toBeVisible();
    await expect(undoCutItemFinal).toBeDisabled();

    await takeScreenshot(mainWindow, undoCutItemFinal, screenshotDir, step++, 'undo-cut-disabled-again');
    writeNarration(
      screenshotDir,
      step++,
      `With nothing cut anymore, Undo Cut is grayed out once again — exactly where we started.`
    );

    await mainWindow.keyboard.press('Escape');
    await expect(undoCutItemFinal).toHaveCount(0);

    // Cleanup: remove the demo folder so nothing this test created lingers.
    fs.rmSync(demoFolderPath, { recursive: true, force: true });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'done');
    writeNarration(
      screenshotDir,
      step++,
      `That wraps up the selection tools and the Undo Cut safety net: Select All and Unselect All manage your selection in a single click, and Undo Cut lets you back out of a cut before anything is ever moved.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
