import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot,
  writeNarration,
  demoClick,
  demoRightClick,
  setCheckbox,
  logScreenshotSummary,
  cleanupScreenshots,
  cleanupTestDataFiles,
  resetSettings,
} from './helpers/mediaUtils';

/**
 * Private E2E Test: Copy Link / Paste Link
 *
 * Exercises the Copy Link / Paste Link workflow (USER_GUIDE.md § Copy Link):
 * capture files in the browser with selection checkboxes + Edit menu > Copy
 * Link, then paste them as relative Markdown links into a markdown file being
 * edited in a *different* folder.
 *
 *   1. Copy Link remembers the selected items and clears the checkboxes
 *      automatically, without moving or modifying any files.
 *   2. Paste Link (editor right-click context menu) inserts one link per
 *      captured item at the cursor.
 *   3. Paths are computed relative to the file being edited (e.g. `../images/…`).
 *   4. Image files paste as inline images (`![name](path)`), documents as
 *      normal links (`[name](path)`).
 *   5. The links survive a save — verified byte-level on disk — and the pasted
 *      image actually renders in the file's rendered view.
 *
 * Copy Link captures one selection set at a time, and a second Copy Link
 * replaces the first. The two link targets live in different folders, so one
 * checkbox pass cannot reach both. The test therefore runs two rounds: round
 * one captures + pastes the image, round two captures + pastes the document.
 *
 * This test is private (not part of the demo video set) — it still writes
 * screenshots/narration to follow the shared conventions, but its primary
 * purpose is automated verification of the Copy Link / Paste Link feature.
 */
test.describe('Private: Copy Link and Paste Link', () => {
  test('capture files with Copy Link and paste them as relative markdown links', async ({ mainWindow, testDataPath }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // Seed a dedicated tree. cleanupTestDataFiles() removes my-*.md files
    // recursively but not the folders themselves or the PNG, so remove and
    // recreate the whole tree here for a clean slate.
    const demoFolderName = 'my-copylink-demo';
    const demoFolderPath = path.join(testDataPath, demoFolderName);
    fs.rmSync(demoFolderPath, { recursive: true, force: true });

    const imagesPath = path.join(demoFolderPath, 'images');
    const referencePath = path.join(demoFolderPath, 'reference');
    const writingPath = path.join(demoFolderPath, 'writing');
    fs.mkdirSync(imagesPath, { recursive: true });
    fs.mkdirSync(referencePath, { recursive: true });
    fs.mkdirSync(writingPath, { recursive: true });

    // Copy a real, valid PNG in as the diagram so it actually renders on screen.
    fs.copyFileSync(
      path.join(testDataPath, 'images', 'Firefox-logo.png'),
      path.join(imagesPath, 'diagram.png')
    );

    const sourceNotesName = 'my-source-notes.md';
    fs.writeFileSync(
      path.join(referencePath, sourceNotesName),
      `# Source Notes\n\nBackground research that our report will link to.\n`
    );

    const reportName = 'my-report.md';
    const reportPath = path.join(writingPath, reportName);
    // Body is exactly one line so the expected final file content is predictable.
    fs.writeFileSync(reportPath, `# My Report`);

    // Expected relative paths from writing/my-report.md.
    const imageLink = '![diagram.png](../images/diagram.png)';
    const docLink = '[my-source-notes.md](../reference/my-source-notes.md)';

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // The tree was written to disk after the app started reading the folder,
    // so refresh to make sure it shows up.
    await demoClick(mainWindow.getByTestId('refresh-button'));

    const mainContent = mainWindow.getByTestId('browser-main-content');
    await expect(mainContent.getByText(demoFolderName, { exact: true })).toBeVisible({ timeout: 10000 });

    // ── 1. Initial view ───────────────────────────────────────────────
    await demoClick(mainContent.getByText(demoFolderName, { exact: true }));

    for (const folder of ['images', 'reference', 'writing']) {
      await expect(mainContent.getByText(folder, { exact: true })).toBeVisible({ timeout: 10000 });
    }

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. Today we're looking at Copy Link, which lets you link to files that live in other folders without typing paths by hand.
This demo folder holds three subfolders: an images folder, a reference folder, and a writing folder.
We'll link a diagram and a notes file into a report, letting MkBrowser work out the relative paths for us.`
    );

    // ── 2. Round one — capture the image ──────────────────────────────
    await demoClick(mainContent.getByText('images', { exact: true }));
    await expect(mainContent.getByText('diagram.png').first()).toBeVisible({ timeout: 10000 });

    const imageCheckbox = mainContent.getByRole('checkbox', { name: 'Select diagram.png' });
    await setCheckbox(imageCheckbox, true);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'image-selected');
    writeNarration(
      screenshotDir,
      step++,
      `Inside the images folder we've checked the selection checkbox on diagram.png.
This is the file we want to capture — next we'll tell MkBrowser to remember it with Copy Link.`
    );

    const editMenuButton = mainWindow.getByTestId('edit-menu-button');
    await demoClick(editMenuButton);

    const copyLinkItem = mainWindow.getByTestId('menu-copy-link');
    await expect(copyLinkItem).toBeVisible();
    await takeScreenshot(mainWindow, copyLinkItem, screenshotDir, step++, 'about-to-copy-link-image');
    writeNarration(
      screenshotDir,
      step++,
      `The Edit menu is open, and we can see the Copy Link option.
Copy Link doesn't move or change anything — it simply remembers the selected files so we can paste links to them somewhere else.`
    );

    await demoClick(copyLinkItem);

    // Copy Link clears the selection automatically.
    await expect(imageCheckbox).not.toBeChecked();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'image-captured-checkbox-cleared');
    writeNarration(
      screenshotDir,
      step++,
      `Notice the checkbox cleared itself the moment we clicked Copy Link.
Nothing was moved or modified — the path to diagram.png was merely remembered, ready to be pasted as a link.`
    );

    // ── 3. Round one — paste the image link ───────────────────────────
    await demoClick(mainWindow.getByTestId('navigate-up-button'));
    await demoClick(mainContent.getByText('writing', { exact: true }));
    await expect(mainContent.getByText(reportName).first()).toBeVisible({ timeout: 10000 });

    const reportEntry = mainContent
      .getByTestId('browser-entry-markdown')
      .filter({ has: mainWindow.locator(`text="${reportName}"`) })
      .first();

    // Markdown entries render expanded by default, so the body is already
    // visible. Click its rendered body (the heading) to enter edit mode.
    const reportHeading = reportEntry.getByRole('heading', { name: 'My Report' });
    await expect(reportHeading).toBeVisible({ timeout: 10000 });
    await demoClick(reportHeading);

    const saveButton = mainWindow.getByTestId('entry-save-button');
    await expect(saveButton).toBeVisible({ timeout: 10000 });

    // Put the cursor on a fresh blank line after the heading so the pasted link
    // lands on its own line.
    const editorContent = reportEntry.locator('.cm-content');
    await editorContent.click();
    await mainWindow.keyboard.press('Control+End');
    await mainWindow.keyboard.press('Enter');
    await mainWindow.keyboard.press('Enter');

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'report-in-edit-mode');
    writeNarration(
      screenshotDir,
      step++,
      `We've opened the report for editing over in the writing folder — a completely different folder from where the image lives.
The cursor is parked on a fresh line, and now we'll paste the link we captured.`
    );

    await demoRightClick(editorContent);

    const pasteLinkItem = mainWindow.getByTestId('editor-paste-link');
    await expect(pasteLinkItem).toBeVisible();
    await takeScreenshot(mainWindow, pasteLinkItem, screenshotDir, step++, 'about-to-paste-image-link');
    writeNarration(
      screenshotDir,
      step++,
      `Right-clicking in the editor opens its context menu, where the Paste Link item appears because we have a file captured.
We'll click it to drop in a link to the diagram.`
    );

    await demoClick(pasteLinkItem);

    // Image files paste as inline images with a path relative to the report.
    await expect(editorContent).toContainText(imageLink);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'image-link-pasted');
    writeNarration(
      screenshotDir,
      step++,
      `There it is: an inline image link. Because diagram.png is an image, MkBrowser pasted it as an image embed rather than a plain link.
And notice the path — ../images/diagram.png — computed automatically, relative to the report's own folder.`
    );

    // ── 4. Save round one ─────────────────────────────────────────────
    await demoClick(saveButton);
    await expect(saveButton).not.toBeVisible({ timeout: 10000 });

    // The rendered view now displays the inline image. The 1x1 PNG is too small
    // to see, so assert on the <img> element's existence, not its appearance.
    const renderedImage = reportEntry.locator('img[alt="diagram.png"]');
    await expect(renderedImage).toHaveCount(1, { timeout: 10000 });
    await expect(renderedImage).toHaveAttribute('src', /diagram\.png$/);

    // Disk assertion: the file contains the exact image-link line.
    await expect(async () => {
      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain(imageLink);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'image-link-saved');
    writeNarration(
      screenshotDir,
      step++,
      `We saved, and the report now renders the diagram inline, pulling the image from the other folder through the relative link.
The link is written to disk exactly as we saw it, and the diagram itself was never touched or moved.`
    );

    // ── 5. Round two — capture the document ───────────────────────────
    await demoClick(mainWindow.getByTestId('navigate-up-button'));
    await demoClick(mainContent.getByText('reference', { exact: true }));
    await expect(mainContent.getByText(sourceNotesName).first()).toBeVisible({ timeout: 10000 });

    const docCheckbox = mainContent.getByRole('checkbox', { name: `Select ${sourceNotesName}` });
    await setCheckbox(docCheckbox, true);

    await demoClick(editMenuButton);
    const copyLinkItem2 = mainWindow.getByTestId('menu-copy-link');
    await expect(copyLinkItem2).toBeVisible();
    await takeScreenshot(mainWindow, copyLinkItem2, screenshotDir, step++, 'about-to-copy-link-doc');
    writeNarration(
      screenshotDir,
      step++,
      `Now for round two. Over in the reference folder we've selected the source notes file and opened the Edit menu again.
Copy Link only remembers one set of files at a time, so this new Copy Link replaces the diagram we captured earlier.`
    );

    await demoClick(copyLinkItem2);
    await expect(docCheckbox).not.toBeChecked();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'doc-captured-checkbox-cleared');
    writeNarration(
      screenshotDir,
      step++,
      `Again the checkbox clears automatically — the notes file is now the captured link, and the file itself stays exactly where it is.`
    );

    // ── 6. Round two — paste the document link ────────────────────────
    await demoClick(mainWindow.getByTestId('navigate-up-button'));
    await demoClick(mainContent.getByText('writing', { exact: true }));
    await expect(mainContent.getByText(reportName).first()).toBeVisible({ timeout: 10000 });

    // Re-enter edit mode on the report. It's expanded by default again, so
    // click its rendered heading to open the editor.
    const reportHeading2 = reportEntry.getByRole('heading', { name: 'My Report' });
    await expect(reportHeading2).toBeVisible({ timeout: 10000 });
    await demoClick(reportHeading2);
    await expect(saveButton).toBeVisible({ timeout: 10000 });

    const editorContent2 = reportEntry.locator('.cm-content');
    await editorContent2.click();
    await mainWindow.keyboard.press('Control+End');
    await mainWindow.keyboard.press('Enter');
    await mainWindow.keyboard.press('Enter');

    await demoRightClick(editorContent2);
    const pasteLinkItem2 = mainWindow.getByTestId('editor-paste-link');
    await expect(pasteLinkItem2).toBeVisible();
    await takeScreenshot(mainWindow, pasteLinkItem2, screenshotDir, step++, 'about-to-paste-doc-link');
    writeNarration(
      screenshotDir,
      step++,
      `Back in the report, cursor on a fresh line, we open the editor context menu once more and click Paste Link.`
    );

    await demoClick(pasteLinkItem2);

    // Documents paste as a normal link (not an image embed).
    await expect(editorContent2).toContainText(docLink);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'doc-link-pasted');
    writeNarration(
      screenshotDir,
      step++,
      `This time it's a normal markdown link, not an image, because the notes file is a document.
The relative path — ../reference/my-source-notes.md — was again worked out for us.`
    );

    await demoClick(saveButton);
    await expect(saveButton).not.toBeVisible({ timeout: 10000 });

    // Rendered view now shows a clickable link labeled with the filename.
    const renderedLink = reportEntry.getByRole('link', { name: sourceNotesName });
    await expect(renderedLink).toBeVisible({ timeout: 10000 });

    // Disk assertion: both links present, and the original heading intact.
    await expect(async () => {
      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('# My Report');
      expect(content).toContain(imageLink);
      expect(content).toContain(docLink);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'doc-link-saved');
    writeNarration(
      screenshotDir,
      step++,
      `Saved again. The report now has both links — the inline diagram and a link to the source notes — alongside its original heading.
Two files from two different folders, linked into one document without ever typing a path.`
    );

    // ── 7. Prove targets untouched ────────────────────────────────────
    await expect(async () => {
      expect(fs.existsSync(path.join(imagesPath, 'diagram.png'))).toBe(true);
      expect(fs.existsSync(path.join(referencePath, sourceNotesName))).toBe(true);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'targets-untouched');
    writeNarration(
      screenshotDir,
      step++,
      `Finally, a quick check: the diagram and the notes file are both still sitting in their original folders.
Copy Link only ever remembers and links to files — it never moves or copies them.`
    );

    // ── 8. Cleanup ────────────────────────────────────────────────────
    fs.rmSync(demoFolderPath, { recursive: true, force: true });

    writeNarration(
      screenshotDir,
      step++,
      `That's the Copy Link and Paste Link workflow: capture files anywhere, then paste correct relative links wherever you're writing.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
