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
 * Private E2E Test: Paste Clipboard Image as Attachment
 *
 * The image-path sibling of private-clipboard-attachment.spec.ts (the text
 * path). Exercises the "Paste Clipboard as Attachment" feature when the OS
 * clipboard holds an image rather than text:
 *   1. Seeds a subfolder with a single markdown file that has no attachments.
 *   2. Places a real PNG image on the OS clipboard (via Electron's main-process
 *      clipboard + nativeImage modules), loaded from the checked-in fixture
 *      images in `mkbrowser-test/images/`.
 *   3. Clicks the paste-clipboard-attachment button on the file's action bar,
 *      which creates a `<name>.md.attach/` folder and writes the clipboard image
 *      into a timestamp-named `.png` file inside it.
 *   4. Verifies the folder + PNG file on disk (magic bytes) and in the UI, and
 *      that the image renders inline when navigating into the attachments folder.
 *   5. Pastes a second image onto the same file and confirms it lands in the
 *      existing attachments folder alongside the first (two .png files total).
 *
 * The attachment filename is time-dependent, so it is always discovered with
 * fs.readdirSync + a regex rather than hardcoded. The image travels the OS
 * clipboard → Chromium Clipboard API → re-encode round-trip, so the bytes on
 * disk will NOT equal the source fixture image — we assert PNG magic bytes +
 * nonzero length instead of byte equality.
 *
 * This test is private (not part of the demo video set) — it still writes
 * screenshots/narration to follow the shared conventions, but its primary
 * purpose is automated verification of the clipboard-image-attachment feature.
 */

// Matches the timestamp filename produced by generateTimestampFilename('.png'):
// YYYY-MM-DD--HH-MM-SS.png
const TIMESTAMP_PNG_RE = /^\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}\.png$/;

// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Real fixture images that live in `mkbrowser-test/images/` (the test data
// root). We seed the clipboard from these actual files — unlike a 1x1 pixel
// they render visibly, and the two distinct images make the two pastes easy to
// tell apart. The bytes written to disk won't match these (the clipboard
// round-trip re-encodes the image), so we only assert PNG magic bytes + size.
const FIXTURE_IMAGE_1 = 'Brave-logo.png';
const FIXTURE_IMAGE_2 = 'Firefox-logo.png';

/** True if the file at the given path begins with the PNG magic bytes and has content beyond them. */
function isValidPng(filePath: string): boolean {
  const buf = fs.readFileSync(filePath);
  return buf.length > 8 && buf.subarray(0, 8).equals(PNG_MAGIC);
}

test.describe('Private: Paste Clipboard Image as Attachment', () => {
  test('paste clipboard image as an attachment under a markdown file', async ({
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
    // folder itself (nor the .attach folder + .png files this test creates), so
    // remove and recreate the folder here for a clean slate.
    const demoFolderName = 'my-clip-image-demo';
    const demoFolderPath = path.join(testDataPath, demoFolderName);
    fs.rmSync(demoFolderPath, { recursive: true, force: true });
    fs.mkdirSync(demoFolderPath);

    const hostFileName = 'my-image-host.md';
    const attachFolderName = `${hostFileName}.attach`;
    const attachFolderPath = path.join(demoFolderPath, attachFolderName);
    fs.writeFileSync(
      path.join(demoFolderPath, hostFileName),
      `# Image Host\n\nThis file will receive clipboard image attachments.\n`
    );

    // The real fixture images to seed the clipboard from. These are assumed to
    // already exist under `mkbrowser-test/images/`.
    const imagesDir = path.join(testDataPath, 'images');
    const image1Path = path.join(imagesDir, FIXTURE_IMAGE_1);
    const image2Path = path.join(imagesDir, FIXTURE_IMAGE_2);
    expect(fs.existsSync(image1Path)).toBe(true);
    expect(fs.existsSync(image2Path)).toBe(true);

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
      `Welcome to MkBrowser. Today we're looking at pasting images from your clipboard — every markdown file can attach whatever image you've copied, stored right next to the file.
Here is a single markdown file with no attachments yet; imagine you've just taken a screenshot, and let's attach it straight from the clipboard.`
    );

    // Seed the OS clipboard with a real PNG image via Electron's main-process
    // clipboard + nativeImage modules. The main process has filesystem access,
    // so we pass the absolute image path and load it there with createFromPath.
    const seeded1 = await electronApp.evaluate(({ clipboard, nativeImage }, imgPath) => {
      clipboard.writeImage(nativeImage.createFromPath(imgPath));
      return !clipboard.readImage().isEmpty();
    }, image1Path);
    expect(seeded1).toBe(true);

    writeNarration(
      screenshotDir,
      step++,
      `We've placed an image on the system clipboard, as if we had just taken a screenshot.
Now we'll paste it as an attachment under our file.`
    );

    // Locate the file's hover-revealed action bar and its paste-clipboard button.
    let actionBar = findActionBarByFileName(mainContent, hostFileName);
    await actionBar.hover();
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

    // Verify the attachments folder was created with exactly one timestamped
    // .png file that is a valid PNG (magic bytes + nonzero content).
    await expect(async () => {
      expect(fs.existsSync(attachFolderPath)).toBe(true);
      const files = fs.readdirSync(attachFolderPath).filter((f) => TIMESTAMP_PNG_RE.test(f));
      expect(files).toHaveLength(1);
      expect(isValidPng(path.join(attachFolderPath, files[0]!))).toBe(true);
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
      `The clipboard image has been saved as an attachment.
Notice the new folder that appeared, named after the file with a ".attach" suffix — the app automatically detected the clipboard held an image and saved it as a .png there.`
    );

    // Capture the first attachment's filename so we can identify the second
    // paste later by diffing the directory listing.
    const firstAttachName = fs
      .readdirSync(attachFolderPath)
      .filter((f) => TIMESTAMP_PNG_RE.test(f))[0]!;

    // Navigate into the attachments folder and confirm the pasted image renders.
    await demoClick(mainContent.getByText(attachFolderName, { exact: true }));

    await expect(mainContent.getByText(firstAttachName).first()).toBeVisible({ timeout: 10000 });
    // Image entries render an inline <img> (alt = the file name) only when
    // expanded. The paste flow may auto-expand it, but don't depend on that:
    // click the entry to expand if the img isn't present yet.
    const pastedImg = mainContent.locator(`img[alt="${firstAttachName}"]`);
    if (!(await pastedImg.count().then((c) => c > 0).catch(() => false))) {
      await demoClick(mainContent.getByText(firstAttachName).first());
    }
    await expect(pastedImg).toBeAttached({ timeout: 10000 });
    // Assert the element and its src rather than pixel-level appearance.
    await expect(pastedImg).toHaveAttribute('src', /.+/);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'inside-attach-folder');
    writeNarration(
      screenshotDir,
      step++,
      `Inside the attachments folder we find the pasted image, named with a timestamp.
It renders inline just like any other image in MkBrowser — here's the picture we copied from the clipboard.`
    );

    // Back up to the folder containing the host file.
    await demoClick(mainWindow.getByTestId('navigate-up-button'));
    await expect(mainContent.getByText(hostFileName).first()).toBeVisible({ timeout: 10000 });

    // Guard against a timestamp collision: if both pastes land in the same
    // second, the second file would overwrite the first with the same name.
    await mainWindow.waitForTimeout(1500);

    // Seed the clipboard with the second (different) fixture image and paste
    // again onto the same file — it should reuse the existing attachments folder.
    const seeded2 = await electronApp.evaluate(({ clipboard, nativeImage }, imgPath) => {
      clipboard.writeImage(nativeImage.createFromPath(imgPath));
      return !clipboard.readImage().isEmpty();
    }, image2Path);
    expect(seeded2).toBe(true);

    actionBar = findActionBarByFileName(mainContent, hostFileName);
    await actionBar.hover();
    pasteButton = actionBar.getByTestId('entry-paste-clipboard-attachment-button');
    await expect(pasteButton).toBeVisible();

    await takeScreenshot(mainWindow, pasteButton, screenshotDir, step++, 'about-to-paste-second');
    writeNarration(
      screenshotDir,
      step++,
      `Now we place a second image on the clipboard and paste it under the same file.
This time the attachments folder already exists, so the new image simply joins the first one.`
    );

    await demoClick(pasteButton, { force: true });

    // Verify the attachments folder now holds two timestamped .png files, both
    // valid PNGs, and that the second is a newly-named file (not an overwrite).
    await expect(async () => {
      const files = fs.readdirSync(attachFolderPath).filter((f) => TIMESTAMP_PNG_RE.test(f));
      expect(files).toHaveLength(2);
      for (const f of files) {
        expect(isValidPng(path.join(attachFolderPath, f))).toBe(true);
      }
      // One of them is the original; the other is the new paste.
      expect(files.some((f) => f === firstAttachName)).toBe(true);
      expect(files.some((f) => f !== firstAttachName)).toBe(true);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'second-attachment-added');
    writeNarration(
      screenshotDir,
      step++,
      `The second paste reused the existing attachments folder, which now holds both pasted images side by side.
That's how the "Paste Clipboard as Attachment" feature collects clipboard images under any file.`
    );

    // Cleanup: clear the clipboard so later tests aren't affected by our seeded
    // image, then remove the whole demo folder tree (including .attach + .png).
    await electronApp.evaluate(({ clipboard }) => clipboard.clear());
    fs.rmSync(demoFolderPath, { recursive: true, force: true });

    logScreenshotSummary(screenshotDir);
  });
});
