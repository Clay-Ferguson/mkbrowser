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
  findActionBarByFileName,
} from './helpers/mediaUtils';

/**
 * Private E2E Test: Paste Clipboard as Attachment
 *
 * Exercises the "Paste Clipboard as Attachment" feature on a markdown entry:
 *   1. Seeds a subfolder with a single markdown file that has no attachments.
 *   2. Places a known markdown string on the OS clipboard (via Electron's
 *      main-process clipboard module).
 *   3. Clicks the paste-clipboard-attachment button on the file's action bar,
 *      which creates a `<name>.md.attach/` folder and writes the clipboard text
 *      into a timestamp-named `.md` file inside it.
 *   4. Verifies the folder + file on disk and in the UI, and that the pasted
 *      markdown renders when navigating into the attachments folder.
 *   5. Pastes a second clipboard text onto the same file and confirms it lands
 *      in the existing attachments folder alongside the first (two files total).
 *
 * The attachment filename is time-dependent, so it is always discovered with
 * fs.readdirSync + a regex rather than hardcoded.
 *
 * This test is private (not part of the demo video set) — it still writes
 * screenshots/narration to follow the shared conventions, but its primary
 * purpose is automated verification of the clipboard-attachment feature.
 */

// Matches the timestamp filename produced by generateTimestampFilename('.md'):
// YYYY-MM-DD--HH-MM-SS-mmm.md
const TIMESTAMP_MD_RE = /^\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}-\d{3}\.md$/;

test.describe('Private: Paste Clipboard as Attachment', () => {
  test('paste clipboard text as an attachment under a markdown file', async ({
    electronApp,
    mainWindow,
    testDataPath,
  }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // Seed a dedicated subfolder with a single markdown file and no attachments.
    // cleanupTestDataFiles() removes my-*.md files recursively but not the
    // folder itself (nor the .attach folder this test creates), so remove and
    // recreate the folder here for a clean slate.
    const demoFolderName = 'my-clip-attach-demo';
    const demoFolderPath = path.join(testDataPath, demoFolderName);
    fs.rmSync(demoFolderPath, { recursive: true, force: true });
    fs.mkdirSync(demoFolderPath);

    const hostFileName = 'my-host-note.md';
    const attachFolderName = `${hostFileName}.attach`;
    const attachFolderPath = path.join(demoFolderPath, attachFolderName);
    fs.writeFileSync(
      path.join(demoFolderPath, hostFileName),
      `# Host Note\n\nThis file will receive clipboard attachments.\n`
    );

    // Two distinctive, greppable clipboard payloads.
    const clipText1 = '# Pasted Note One\n\nThis paragraph arrived from the clipboard.';
    const clipText2 =
      '# Pasted Note Two\n\nA second clipboard paste into the same attachments folder.';

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // The folder was written to disk after the app started reading the
    // directory, so refresh to make sure it shows up.
    await demoClick(mainWindow.getByTestId('refresh-button'));

    const mainContent = mainWindow.getByTestId('browser-main-content');
    await expect(mainContent.getByText(demoFolderName, { exact: true })).toBeVisible({
      timeout: 10000,
    });

    // Navigate into the demo folder.
    await demoClick(mainContent.getByText(demoFolderName, { exact: true }));

    await expect(mainContent.getByText(hostFileName).first()).toBeVisible({ timeout: 10000 });
    // No attachments folder exists yet.
    expect(fs.existsSync(attachFolderPath)).toBe(false);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. Today we're looking at clipboard attachments — every markdown file has a shortcut to paste whatever is on your clipboard as an attachment stored right next to it.
Here is a single markdown file with no attachments yet; let's use it to attach some clipboard text.`
    );

    // Seed the OS clipboard with the first payload via Electron's main-process
    // clipboard module (the renderer's navigator.clipboard.read() reads the same
    // OS clipboard).
    await electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipText1);

    writeNarration(
      screenshotDir,
      step++,
      `We've placed a short piece of markdown text on the system clipboard.
Now we'll paste it as an attachment under our file.`
    );

    // Locate the file's hover-revealed action bar and its paste-clipboard button.
    // The icons fade in on hover with a delay (EntryActionBar.tsx: 400ms delay +
    // 200ms opacity transition), so wait for the fade or screenshots capture
    // invisible icons (toBeVisible() passes even at opacity 0).
    let actionBar = findActionBarByFileName(mainContent, hostFileName);
    await actionBar.hover();
    await mainWindow.waitForTimeout(700);
    let pasteButton = actionBar.getByTestId('entry-paste-clipboard-attachment-button');
    await expect(pasteButton).toBeVisible();

    await takeScreenshot(mainWindow, pasteButton, screenshotDir, step++, 'about-to-paste-first');
    writeNarration(
      screenshotDir,
      step++,
      `Hovering over the file reveals its action bar.
This clipboard button pastes whatever is on the clipboard as an attachment under this file, creating an attachments folder if one doesn't exist yet.`
    );

    await demoClick(pasteButton, { force: true });

    // Verify the attachments folder was created with exactly one timestamped .md
    // file whose content is the pasted clipboard text.
    await expect(async () => {
      expect(fs.existsSync(attachFolderPath)).toBe(true);
      const files = fs.readdirSync(attachFolderPath).filter((f) => TIMESTAMP_MD_RE.test(f));
      expect(files).toHaveLength(1);
      const content = fs.readFileSync(path.join(attachFolderPath, files[0]!), 'utf-8');
      expect(content).toContain('Pasted Note One');
      expect(content).toContain('This paragraph arrived from the clipboard.');
    }).toPass({ timeout: 10000 });

    // The paste writes through the app which refreshes the directory; make sure
    // the new folder is shown (refresh to be safe) and visible in the list.
    await demoClick(mainWindow.getByTestId('refresh-button'));
    await expect(mainContent.getByText(attachFolderName, { exact: true })).toBeVisible({
      timeout: 10000,
    });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'attach-folder-created');
    writeNarration(
      screenshotDir,
      step++,
      `The clipboard text has been saved as an attachment.
Notice the new folder that appeared, named after the file with a ".attach" suffix — that's where this file's attachments live.`
    );

    // Navigate into the attachments folder and confirm the pasted markdown renders.
    await demoClick(mainContent.getByText(attachFolderName, { exact: true }));

    const firstAttachName = fs
      .readdirSync(attachFolderPath)
      .filter((f) => TIMESTAMP_MD_RE.test(f))[0]!;
    await expect(mainContent.getByText(firstAttachName).first()).toBeVisible({ timeout: 10000 });
    // The paste flow auto-expands the new file, but don't depend on that: if the
    // rendered heading isn't visible, click the file name to expand it.
    const pastedHeading = mainContent.getByText('Pasted Note One').first();
    if (!(await pastedHeading.isVisible().catch(() => false))) {
      await demoClick(mainContent.getByText(firstAttachName).first());
    }
    await expect(pastedHeading).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'inside-attach-folder');
    writeNarration(
      screenshotDir,
      step++,
      `Inside the attachments folder we find the pasted file, named with a timestamp.
Its markdown renders just like any other file — here's the "Pasted Note One" heading we copied from the clipboard.`
    );

    // Back up to the folder containing the host file.
    await demoClick(mainWindow.getByTestId('navigate-up-button'));
    await expect(mainContent.getByText(hostFileName).first()).toBeVisible({ timeout: 10000 });

    // Seed the clipboard with the second payload and paste again onto the same
    // file — it should reuse the existing attachments folder.
    await electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipText2);

    actionBar = findActionBarByFileName(mainContent, hostFileName);
    await actionBar.hover();
    await mainWindow.waitForTimeout(700);   // wait out the action-bar fade-in
    pasteButton = actionBar.getByTestId('entry-paste-clipboard-attachment-button');
    await expect(pasteButton).toBeVisible();

    await takeScreenshot(mainWindow, pasteButton, screenshotDir, step++, 'about-to-paste-second');
    writeNarration(
      screenshotDir,
      step++,
      `Now we place a second, different piece of markdown on the clipboard and paste it under the same file.
This time the attachments folder already exists, so the new file simply joins the first one.`
    );

    await demoClick(pasteButton, { force: true });

    // Verify the attachments folder now holds two timestamped .md files, one
    // with each payload's distinctive content.
    await expect(async () => {
      const files = fs.readdirSync(attachFolderPath).filter((f) => TIMESTAMP_MD_RE.test(f));
      expect(files).toHaveLength(2);
      const contents = files.map((f) => fs.readFileSync(path.join(attachFolderPath, f), 'utf-8'));
      expect(contents.some((c) => c.includes('Pasted Note One'))).toBe(true);
      expect(contents.some((c) => c.includes('Pasted Note Two'))).toBe(true);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'second-attachment-added');
    writeNarration(
      screenshotDir,
      step++,
      `The second paste reused the existing attachments folder, which now holds both pasted notes side by side.
That's how the "Paste Clipboard as Attachment" feature collects clipboard content under any file.`
    );

    // Cleanup: clear the clipboard so later tests aren't affected by our seeded
    // content, then remove the whole demo folder tree (including .attach).
    await electronApp.evaluate(({ clipboard }) => clipboard.clear());
    fs.rmSync(demoFolderPath, { recursive: true, force: true });

    logScreenshotSummary(screenshotDir);
  });
});
