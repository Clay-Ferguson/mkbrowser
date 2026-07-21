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
 * Private E2E Test: Browse File (single-file browsing)
 *
 * Clicking a file in the index tree shows it on its own in the right-hand
 * pane, in place of the folder listing. This test covers the round trip and
 * the behaviors that carry real regression risk:
 *
 *   1. Clicking a file swaps BrowseView out for BrowseFile, showing only that
 *      file — a sibling file in the same folder must NOT be visible. For a
 *      markdown file the same click ALSO expands its headings in the tree;
 *      both halves are asserted, since either could regress alone.
 *   2. Click-to-edit still works there. This is the assertion that matters:
 *      the entry components render their own CodeMirror, so editing is meant
 *      to work identically outside the list. Verified through to disk.
 *   3. Breadcrumb navigation exits single-file mode (setCurrentPath clears
 *      browseFileName), restoring the folder listing.
 *   4. "Browse" on a file returns to the listing, and clicking a folder in the
 *      tree navigates rather than entering single-file mode.
 *
 * This test is private (not part of the demo video set) — it still writes
 * screenshots/narration per the shared conventions, but its purpose is
 * automated verification.
 */
test.describe('Private: Browse File', () => {
  test('browse a single file, edit it there, and return to the folder listing', async ({ mainWindow, testDataPath }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // --- Seed on disk ------------------------------------------------------
    // The file we will browse on its own, plus a sibling that must stay hidden
    // while single-file mode is active (that's how we know the listing really
    // was replaced rather than merely scrolled).
    //
    // These live in a subfolder so Phase 3 exercises a breadcrumb exit that
    // actually changes folders; Phase 3b then covers the root-level case,
    // where the home button is the only clickable segment there is.
    const folderName = 'my-browse-folder';
    const folderPath = path.join(testDataPath, folderName);
    const targetName = 'my-browse-target.md';
    const siblingName = 'my-browse-sibling.md';
    fs.rmSync(folderPath, { recursive: true, force: true });
    fs.mkdirSync(folderPath);
    // Sub-headings below the title are deliberate: the Phase 1 tree-expansion
    // assertion below looks for heading nodes nested under the file, so the
    // fixture needs a heading structure with more than one level.
    fs.writeFileSync(
      path.join(folderPath, targetName),
      `# Browse Target\n\nThe file we view on its own.\n\n## First Section\n\nSection one body.\n\n## Second Section\n\nSection two body.\n`
    );
    fs.writeFileSync(
      path.join(folderPath, siblingName),
      `# Browse Sibling\n\nThis must not appear in single-file mode.\n`
    );

    let step = 1;

    await mainWindow.waitForTimeout(2000);

    // The folder was created after the app read the directory, so refresh.
    await demoClick(mainWindow.getByTestId('refresh-button'));

    const listing = mainWindow.getByTestId('browser-main-content');
    await demoClick(listing.getByText(folderName, { exact: true }));

    await expect(listing.getByText(targetName, { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(listing.getByText(siblingName, { exact: true })).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'folder-listing');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. We're looking at single-file browsing.
Right now the right-hand pane shows the whole folder listing — two markdown files among them.
Let's pull one of them up on its own.`
    );

    // --- Phase 1: click a file in the tree ---------------------------------
    const tree = mainWindow.getByTestId('file-explorer-tree');
    await expect(tree).toBeVisible({ timeout: 10000 });

    // Expand the seeded folder in the tree so its files are reachable there.
    await demoClick(tree.getByText(folderName, { exact: true }).first());

    const treeTarget = tree.getByText(targetName, { exact: true }).first();
    await treeTarget.scrollIntoViewIfNeeded();

    await takeScreenshot(mainWindow, treeTarget, screenshotDir, step++, 'about-to-click-tree-file');
    writeNarration(
      screenshotDir,
      step++,
      `Clicking a file in the tree opens it on its own — no menu needed.`
    );

    await demoClick(treeTarget);

    // BrowseFile replaced BrowseView: its pane is present, the listing's is not.
    const single = mainWindow.getByTestId('browse-file-main-content');
    await expect(single).toBeVisible({ timeout: 10000 });
    await expect(mainWindow.getByTestId('browser-main-content')).toHaveCount(0);

    // The browsed file is there, expanded (its rendered heading is visible),
    // and the sibling is gone from the pane. Scoped to the pane on purpose:
    // the index tree on the left still lists every file in the folder, which
    // is exactly right — single-file mode replaces the listing, not the tree.
    await expect(single.getByRole('heading', { name: 'Browse Target' })).toBeVisible({ timeout: 10000 });
    await expect(single.getByText(siblingName, { exact: true })).toHaveCount(0);

    // The same click also expanded the file's headings in the tree. Asserted
    // separately from the browse half: the two behaviors share one click but
    // are independent code paths, so either could regress on its own.
    // The tree mirrors the file's headings exactly, so the document's own title
    // heading is the single top-level node; the `##` sections sit collapsed
    // beneath it until that node is expanded in turn.
    await expect(tree.getByText('Browse Target', { exact: true })).toBeVisible({ timeout: 10000 });

    // The breadcrumb still tracks the containing folder.
    await expect(mainWindow.getByTestId('browse-file-header-breadcrumbs')).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'single-file-view');
    writeNarration(
      screenshotDir,
      step++,
      `The pane now shows just this one file, already expanded so its content is right there.
The other file in the folder is gone from view, and the breadcrumb above still shows the folder we're in.`
    );

    // --- Phase 2: click-to-edit works here too ------------------------------
    // The entry renders its own CodeMirror, so clicking the rendered body drops
    // into edit mode exactly as it does in the list.
    await demoClick(single.getByRole('heading', { name: 'Browse Target' }));

    const saveButton = mainWindow.getByTestId('entry-save-button');
    await expect(saveButton).toBeVisible({ timeout: 10000 });

    const editorContent = single.locator('.cm-content');
    await editorContent.click();
    await mainWindow.keyboard.press('Control+End');
    await mainWindow.keyboard.press('Enter');
    await mainWindow.keyboard.type('Edited in single-file mode.');

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'editing-in-single-file-view');
    writeNarration(
      screenshotDir,
      step++,
      `Clicking the file's body opened the editor, just like it does in the folder listing.
We've typed a new line at the end. Let's save it.`
    );

    // The editor is ALWAYS maximized here — no toggling required, and the
    // expand/collapse button is hidden because it would be a no-op. Assert the
    // editor really does fill most of the pane: the failure mode if the flex
    // class chain is wrong is a collapsed editor, not a missing one.
    await expect(mainWindow.getByTestId('entry-editor-expand-toggle-button')).toHaveCount(0);

    await expect(async () => {
      const paneBox = await single.boundingBox();
      const editorBox = await single.locator('.cm-editor').boundingBox();
      expect(paneBox).not.toBeNull();
      expect(editorBox).not.toBeNull();
      expect(editorBox!.height).toBeGreaterThan(paneBox!.height * 0.6);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'expanded-editor-in-single-file-view');
    writeNarration(
      screenshotDir,
      step++,
      `The editor fills the whole pane automatically — single-file mode is always expanded, so there's no expand/collapse button to bother with.`
    );

    await demoClick(saveButton);

    // Verify the edit reached disk.
    await expect(async () => {
      const onDisk = fs.readFileSync(path.join(folderPath, targetName), 'utf8');
      expect(onDisk).toContain('Edited in single-file mode.');
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'saved-in-single-file-view');
    writeNarration(
      screenshotDir,
      step++,
      `Saved — the new line is on disk. Editing a file works the same whether you reached it through the folder listing or on its own.`
    );

    // --- Phase 3: breadcrumb returns to the folder listing ------------------
    // Clicking the breadcrumb's home button changes currentPath, which clears
    // the single-file selection and brings the listing back.
    await demoClick(mainWindow.getByTestId('breadcrumb-home-button'));

    await expect(mainWindow.getByTestId('browser-main-content')).toBeVisible({ timeout: 10000 });
    await expect(mainWindow.getByTestId('browse-file-main-content')).toHaveCount(0);
    await expect(listing.getByText(folderName, { exact: true })).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'back-to-listing-via-breadcrumb');
    writeNarration(
      screenshotDir,
      step++,
      `Clicking home in the breadcrumb took us straight back to a full folder listing — single-file mode is over.`
    );

    // --- Phase 3b: the same exit works for a file AT the root --------------
    // The home button is deliberately live even when you are already at the
    // root: for a root-level file the breadcrumb has no other clickable
    // segment, so without it single-file mode would have no breadcrumb exit.
    const rootFileName = 'my-browse-root-file.md';
    fs.writeFileSync(
      path.join(testDataPath, rootFileName),
      `# Root Level File\n\nBrowsed from the root folder.\n`
    );
    await demoClick(mainWindow.getByTestId('refresh-button'));

    await demoClick(tree.getByText(rootFileName, { exact: true }).first());

    const rootSingle = mainWindow.getByTestId('browse-file-main-content');
    await expect(rootSingle).toBeVisible({ timeout: 10000 });
    await expect(rootSingle.getByRole('heading', { name: 'Root Level File' })).toBeVisible({ timeout: 10000 });

    // Home is present and enabled even though we are already at the root.
    const homeAtRoot = mainWindow.getByTestId('breadcrumb-home-button');
    await expect(homeAtRoot).toBeVisible();
    await expect(homeAtRoot).toBeEnabled();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'root-level-file-single-view');
    writeNarration(
      screenshotDir,
      step++,
      `This file lives at the top level, so the breadcrumb has no folder segment to click.
The home button stays available anyway, which is what gets you back to the listing from here.`
    );

    await demoClick(homeAtRoot);

    await expect(mainWindow.getByTestId('browser-main-content')).toBeVisible({ timeout: 10000 });
    await expect(mainWindow.getByTestId('browse-file-main-content')).toHaveCount(0);

    fs.rmSync(path.join(testDataPath, rootFileName), { force: true });

    // --- Phase 4: "Browse" exits; clicking a FOLDER does not enter ---------
    // Re-enter single-file mode with a click, then leave it via the tree's
    // "Browse" item.
    await demoClick(tree.getByText(targetName, { exact: true }).first());
    await expect(mainWindow.getByTestId('browse-file-main-content')).toBeVisible({ timeout: 10000 });

    await demoRightClick(tree.getByText(targetName, { exact: true }).first());
    await demoClick(mainWindow.getByTestId('browse-to-folder'));
    await expect(mainWindow.getByTestId('browser-main-content')).toBeVisible({ timeout: 10000 });
    await expect(mainWindow.getByTestId('browse-file-main-content')).toHaveCount(0);

    // Clicking a FOLDER row still just expands/collapses it in the tree — only
    // files enter single-file mode.
    await demoClick(tree.getByText(folderName, { exact: true }).first());
    await expect(mainWindow.getByTestId('browse-file-main-content')).toHaveCount(0);
    await expect(mainWindow.getByTestId('browser-main-content')).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'folder-click-does-not-enter-single-file');
    writeNarration(
      screenshotDir,
      step++,
      `Clicking a folder in the tree behaves as it always has — it expands and collapses, and never takes over the pane.
Single-file browsing is a file-only gesture, and "Browse" or the breadcrumb always gets you back to the listing.`
    );

    // --- Phase 5: the folder listing kept its own editor preference ---------
    // Single-file mode forces expansion via a prop, NOT by writing the global
    // `expandedEditor` setting. So editing from the listing must still offer
    // the expand/collapse toggle — if this fails, BrowseFile leaked its
    // always-expanded behavior into the user's saved preference.
    //
    // Phase 4's "Browse" already navigated into the seeded folder, so the
    // listing is showing its contents here.
    await expect(listing.getByText(targetName, { exact: true })).toBeVisible({ timeout: 10000 });

    const listingEntry = listing
      .getByTestId('browser-entry-markdown')
      .filter({ has: mainWindow.locator(`text="${targetName}"`) })
      .first();
    await demoClick(listingEntry.getByRole('heading', { name: 'Browse Target' }));

    await expect(mainWindow.getByTestId('entry-save-button')).toBeVisible({ timeout: 10000 });
    await expect(mainWindow.getByTestId('entry-editor-expand-toggle-button')).toBeVisible();

    await demoClick(mainWindow.getByTestId('entry-cancel-button'));

    // --- Cleanup -----------------------------------------------------------
    // The seeded files match the my-*.md pattern the next run's cleanup
    // catches, but the folder holding them does not — remove the whole thing
    // so the test data is left exactly as found.
    fs.rmSync(folderPath, { recursive: true, force: true });

    logScreenshotSummary(screenshotDir);
  });
});
