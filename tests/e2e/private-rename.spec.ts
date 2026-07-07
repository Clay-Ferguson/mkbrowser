import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot,
  writeNarration,
  demoClick,
  demoRightClick,
  logScreenshotSummary,
  cleanupScreenshots,
  cleanupTestDataFiles,
  resetSettings,
} from './helpers/mediaUtils';

/**
 * Private E2E Test: Rename
 *
 * Exercises MkBrowser's inline rename feature in three phases:
 *   1. Renames a markdown file via the inline rename input and verifies on disk.
 *   2. Renames a folder the same way and verifies on disk.
 *   3. Renames a markdown file that owns an attachments folder
 *      (`<name>.md.attach`) and verifies MkBrowser automatically renames the
 *      `.attach` folder to match — keeping the file/attachment association
 *      intact. This association-preserving rename is the high-value assertion.
 *   4. (Bonus) Confirms that pressing Escape cancels a rename in progress,
 *      leaving both the screen and disk unchanged.
 *
 * This test is private (not part of the demo video set) — it still writes
 * screenshots/narration to follow the shared conventions, but its primary
 * purpose is automated verification of the rename feature.
 *
 * Rename is triggered by right-clicking an entry's header row, which swaps the
 * name text for an inline input (see EntryShell.tsx). Enter saves, Escape
 * cancels. This works for both files and folders, so we use right-click for
 * both to keep the flow uniform.
 */
test.describe('Private: Rename', () => {
  test('rename a file, a folder, and a file with an attachments folder', async ({ mainWindow, testDataPath }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // --- Seed on disk ------------------------------------------------------
    // A plain markdown file to rename.
    const fileName = 'my-rename-target.md';
    const renamedFileName = 'my-renamed-target.md';
    // Defensively clear anything sitting at a rename-target path. A rename into
    // a name that already exists would collide and silently leave the inline
    // input open. cleanupTestDataFiles() removes my-*.md *files* but not a
    // *directory* that happens to bear one of these names (e.g. debris from an
    // interrupted run), so wipe both targets (file or dir) with a recursive rm.
    const relocatedFileName = 'my-relocated-note.md';
    for (const target of [renamedFileName, relocatedFileName]) {
      fs.rmSync(path.join(testDataPath, target), { recursive: true, force: true });
    }
    // Note: keep the file/folder names OUT of the markdown body. The renamed
    // entry auto-expands and renders its content, so any heading containing the
    // old name would defeat the "old name is gone" assertions.
    fs.writeFileSync(
      path.join(testDataPath, fileName),
      `# Rename target\n\nA markdown file used by the rename test.\n`
    );

    // A folder to rename. cleanupTestDataFiles() removes my-*.md files
    // recursively but not folders, so remove and recreate it here for a clean
    // slate.
    const folderName = 'my-rename-folder';
    const renamedFolderName = 'my-renamed-folder';
    const folderPath = path.join(testDataPath, folderName);
    const renamedFolderPath = path.join(testDataPath, renamedFolderName);
    fs.rmSync(folderPath, { recursive: true, force: true });
    fs.rmSync(renamedFolderPath, { recursive: true, force: true });
    fs.mkdirSync(folderPath);

    // A markdown file with an attachments folder. The .attach folder holds one
    // file (named with the my-*.md pattern so cleanup catches it).
    const attachedFileName = 'my-attached-note.md';
    const attachFolderName = `${attachedFileName}.attach`;
    const relocatedAttachFolderName = `${relocatedFileName}.attach`;
    const attachFolderPath = path.join(testDataPath, attachFolderName);
    const relocatedAttachFolderPath = path.join(testDataPath, relocatedAttachFolderName);
    const attachmentFileName = 'my-attachment-content.md';
    fs.rmSync(attachFolderPath, { recursive: true, force: true });
    fs.rmSync(relocatedAttachFolderPath, { recursive: true, force: true });
    fs.writeFileSync(
      path.join(testDataPath, attachedFileName),
      `# Attached note\n\nA markdown note that has an attachments folder.\n`
    );
    fs.mkdirSync(attachFolderPath);
    fs.writeFileSync(
      path.join(attachFolderPath, attachmentFileName),
      `# Attachment content\n\nAn attachment belonging to the note.\n`
    );

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // The files/folders were written after the app read the directory, so
    // refresh to make sure they all show up.
    await demoClick(mainWindow.getByTestId('refresh-button'));

    const mainContent = mainWindow.getByTestId('browser-main-content');
    for (const name of [fileName, attachedFileName]) {
      await expect(mainContent.getByText(name).first()).toBeVisible({ timeout: 10000 });
    }
    await expect(mainContent.getByText(folderName, { exact: true })).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-files-visible');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. Today we're looking at the rename feature.
We've got a markdown file, a folder, and a note that has its own attachments folder.
We'll rename each of them in turn, right from the file list.`
    );

    // --- Phase 1: rename the file ------------------------------------------
    // Right-click the file's name to turn it into an editable input. Use an
    // exact match so we hit the file's name span and never a `.attach` folder
    // that merely contains this name as a substring.
    await demoRightClick(mainContent.getByText(fileName, { exact: true }));

    const renameInput = mainContent.locator('input:focus');
    await expect(renameInput).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'file-rename-input');
    writeNarration(
      screenshotDir,
      step++,
      `We right-clicked the file's name, and it turned into an editable text field.
The base name is pre-selected while the extension is preserved.
Let's type a new name and press Enter.`
    );

    await renameInput.fill(renamedFileName);
    await renameInput.press('Enter');

    // The new name appears in the list, the old name is gone.
    await expect(mainContent.getByText(renamedFileName).first()).toBeVisible({ timeout: 10000 });
    await expect(mainContent.getByText(fileName, { exact: true })).toHaveCount(0);

    // Verify on disk: the file was renamed.
    await expect(async () => {
      expect(fs.existsSync(path.join(testDataPath, renamedFileName))).toBe(true);
      expect(fs.existsSync(path.join(testDataPath, fileName))).toBe(false);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'file-renamed');
    writeNarration(
      screenshotDir,
      step++,
      `The file now shows its new name in the list, and on disk it has been renamed too.
Renaming a file is as simple as right-click, type, Enter.`
    );

    // --- Phase 2: rename the folder ----------------------------------------
    await demoRightClick(mainContent.getByText(folderName, { exact: true }));

    const folderRenameInput = mainContent.locator('input:focus');
    await expect(folderRenameInput).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'folder-rename-input');
    writeNarration(
      screenshotDir,
      step++,
      `Folders rename exactly the same way.
We right-clicked the folder, and its name became an editable field.
Here the whole name is selected, since a folder has no extension to protect.`
    );

    await folderRenameInput.fill(renamedFolderName);
    await folderRenameInput.press('Enter');

    await expect(mainContent.getByText(renamedFolderName, { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(mainContent.getByText(folderName, { exact: true })).toHaveCount(0);

    // Verify on disk: the folder was renamed.
    await expect(async () => {
      expect(fs.existsSync(renamedFolderPath)).toBe(true);
      expect(fs.existsSync(folderPath)).toBe(false);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'folder-renamed');
    writeNarration(
      screenshotDir,
      step++,
      `The folder has its new name both on screen and on disk.
Now for the most interesting case: renaming a note that owns an attachments folder.`
    );

    // --- Phase 3: attachment-folder auto-rename ----------------------------
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'about-to-rename-attached-note');
    writeNarration(
      screenshotDir,
      step++,
      `This note has a companion attachments folder, named after it with a dot-attach suffix.
That folder holds any images or files the note references.
When we rename the note, MkBrowser automatically renames the attachments folder to match, so the association is never broken. Let's watch.`
    );

    // Exact match is essential here: the attachments folder is named
    // `my-attached-note.md.attach`, which contains the note's name as a
    // substring and sorts ahead of the file. Without exact we'd rename the
    // folder instead of the note.
    await demoRightClick(mainContent.getByText(attachedFileName, { exact: true }));

    const attachedRenameInput = mainContent.locator('input:focus');
    await expect(attachedRenameInput).toBeVisible({ timeout: 10000 });
    await attachedRenameInput.fill(relocatedFileName);
    await attachedRenameInput.press('Enter');

    await expect(mainContent.getByText(relocatedFileName).first()).toBeVisible({ timeout: 10000 });
    await expect(mainContent.getByText(attachedFileName, { exact: true })).toHaveCount(0);

    // Verify on disk: the note was renamed AND its .attach folder followed,
    // still containing the attachment file. Both old paths are gone.
    await expect(async () => {
      expect(fs.existsSync(path.join(testDataPath, relocatedFileName))).toBe(true);
      expect(fs.existsSync(relocatedAttachFolderPath)).toBe(true);
      expect(fs.existsSync(path.join(relocatedAttachFolderPath, attachmentFileName))).toBe(true);
      expect(fs.existsSync(path.join(testDataPath, attachedFileName))).toBe(false);
      expect(fs.existsSync(attachFolderPath)).toBe(false);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'attached-note-renamed');
    writeNarration(
      screenshotDir,
      step++,
      `The note now has its new name, and behind the scenes the dot-attach folder was renamed right along with it.
The attachment file is still safely inside, so the note and its attachments stayed linked automatically.
This is exactly what you want: renaming a note never orphans its attachments.`
    );

    // --- Phase 4 (bonus): Escape cancels a rename --------------------------
    await demoRightClick(mainContent.getByText(relocatedFileName, { exact: true }));

    const cancelRenameInput = mainContent.locator('input:focus');
    await expect(cancelRenameInput).toBeVisible({ timeout: 10000 });
    await cancelRenameInput.fill('my-should-not-stick.md');

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'about-to-cancel-rename');
    writeNarration(
      screenshotDir,
      step++,
      `One last thing: renames are easy to back out of.
We've started renaming the note and typed a new name — but instead of saving, we'll press Escape.`
    );

    await cancelRenameInput.press('Escape');

    // The name on screen is unchanged and the disk is unchanged.
    await expect(mainContent.getByText(relocatedFileName).first()).toBeVisible({ timeout: 10000 });
    await expect(mainContent.getByText('my-should-not-stick.md', { exact: true })).toHaveCount(0);
    expect(fs.existsSync(path.join(testDataPath, relocatedFileName))).toBe(true);
    expect(fs.existsSync(path.join(testDataPath, 'my-should-not-stick.md'))).toBe(false);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'rename-cancelled');
    writeNarration(
      screenshotDir,
      step++,
      `Pressing Escape cancelled the rename — the note kept its original name, both on screen and on disk.
So renaming files and folders in MkBrowser is quick, reversible, and keeps attachments attached.`
    );

    // --- Cleanup -----------------------------------------------------------
    // Remove folders and .attach folders (cleanupTestDataFiles won't).
    fs.rmSync(renamedFolderPath, { recursive: true, force: true });
    fs.rmSync(relocatedAttachFolderPath, { recursive: true, force: true });
    // The renamed my-*.md file would be caught by the next run's cleanup, but
    // delete it now so the folder is left exactly as found.
    fs.rmSync(path.join(testDataPath, relocatedFileName), { force: true });

    logScreenshotSummary(screenshotDir);
  });
});
