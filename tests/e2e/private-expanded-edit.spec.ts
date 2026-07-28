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
 * Private E2E Test: Expanded ("maximized") editing
 *
 * A maximized editor lives in exactly one place — BrowseFile, the single-file
 * view. Turning the `expandedEditor` preference on does not re-style the folder
 * listing around the entry being edited; it swaps BrowseView out for BrowseFile
 * (see `src/store/expandedEdit.ts`). This test covers that routing end to end:
 *
 *   1. Editing in the listing with the preference off stays inline, siblings and
 *      all, and offers the expand toggle.
 *   2. Expanding mid-edit swaps to BrowseFile, and the unsaved edit buffer
 *      survives the swap (the entry and its CodeMirror really are rebuilt).
 *   3. Collapsing returns to the listing with the editor still open.
 *   4. With the preference on, click-to-edit routes straight to BrowseFile, and
 *      both Save and Cancel drop back to the listing.
 *   5. Clicking a breadcrumb mid-edit lands on a folder listing with normal row
 *      spacing — the regression guard for the bug that motivated this design,
 *      where a stale "something is editing" flag turned every row of the
 *      destination folder into an equal-share flex item.
 *
 * `expandedEditor` is left ON at the end deliberately — each test runs against a
 * throwaway user-data dir (see `createSeededUserDataDir`), so nothing leaks into
 * another spec.
 *
 * This test is private (not part of the demo video set) — it still writes
 * screenshots/narration per the shared conventions, but its purpose is
 * automated verification.
 */
test.describe('Private: Expanded Editing', () => {
  test('expanded editing runs through BrowseFile, and the listing is never restyled', async ({ mainWindow, testDataPath }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // --- Seed on disk ------------------------------------------------------
    // A parent folder holding three markdown files plus a subfolder. The three
    // files are the row-spacing sample for the breadcrumb phase: the parent is
    // where a breadcrumb click from inside the subfolder lands, which is exactly
    // the original bug's repro ("click a breadcrumb while editing").
    const parentName = 'my-expand-folder';
    const parentPath = path.join(testDataPath, parentName);
    const subName = 'my-expand-sub';
    const subPath = path.join(parentPath, subName);
    const targetName = 'my-expand-target.md';
    const siblingName = 'my-expand-sibling.md';
    const rowNames = ['my-expand-row-a.md', 'my-expand-row-b.md', 'my-expand-row-c.md'];

    fs.rmSync(parentPath, { recursive: true, force: true });
    fs.mkdirSync(subPath, { recursive: true });
    rowNames.forEach((name, i) => {
      fs.writeFileSync(path.join(parentPath, name), `# Row ${i + 1}\n\nA short row.\n`);
    });
    fs.writeFileSync(path.join(subPath, targetName), `# Expand Target\n\nThe file we edit.\n`);
    fs.writeFileSync(path.join(subPath, siblingName), `# Expand Sibling\n\nStays visible while editing inline.\n`);

    let step = 1;

    await mainWindow.waitForTimeout(2000);

    const listing = mainWindow.getByTestId('browser-main-content');
    const single = mainWindow.getByTestId('browse-file-main-content');
    const expandToggle = mainWindow.getByTestId('entry-editor-expand-toggle-button');
    const saveButton = mainWindow.getByTestId('entry-save-button');

    // The folders were created after the app read the directory, so refresh.
    await demoClick(mainWindow.getByTestId('refresh-button'));
    await demoClick(listing.getByText(parentName, { exact: true }));
    await expect(listing.getByText(subName, { exact: true })).toBeVisible({ timeout: 10000 });
    await demoClick(listing.getByText(subName, { exact: true }));
    await expect(listing.getByText(targetName, { exact: true })).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'folder-listing');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. We're looking at how the expanded — "maximized" — editor works.
This folder holds two markdown files. Let's open one of them for editing.`
    );

    // --- Phase 1: editing inline, with the preference off -------------------
    // resetSettings leaves expandedEditor at its default of false, so this first
    // edit opens as a normal inline editor inside the listing.
    const targetEntry = listing
      .getByTestId('browser-entry-markdown')
      .filter({ has: mainWindow.locator(`text="${targetName}"`) })
      .first();
    await demoClick(targetEntry.getByRole('heading', { name: 'Expand Target' }));

    await expect(saveButton).toBeVisible({ timeout: 10000 });
    // Still the folder listing: the sibling is right there beside the editor.
    await expect(listing).toBeVisible();
    await expect(single).toHaveCount(0);
    await expect(listing.getByText(siblingName, { exact: true })).toBeVisible();
    await expect(expandToggle).toHaveAttribute('title', 'Expand editor');

    // Type into the buffer WITHOUT saving. Phase 2 checks it survives the swap.
    const unsavedLine = 'Typed before expanding.';
    await listing.locator('.cm-content').click();
    await mainWindow.keyboard.press('Control+End');
    await mainWindow.keyboard.press('Enter');
    await mainWindow.keyboard.type(unsavedLine);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'editing-inline');
    writeNarration(
      screenshotDir,
      step++,
      `The editor opened right inside the listing — the other file in the folder is still visible below it.
We've typed a line without saving. Now let's maximize the editor.`
    );

    // --- Phase 2: expanding swaps in BrowseFile -----------------------------
    await demoClick(expandToggle);

    await expect(single).toBeVisible({ timeout: 10000 });
    await expect(listing).toHaveCount(0);
    // The toggle stays available here — unlike plain single-file browsing, this
    // pane was handed over by the user's preference, so they can hand it back.
    await expect(expandToggle).toHaveAttribute('title', 'Collapse editor');
    // The unsaved buffer came through the remount intact.
    await expect(single.locator('.cm-content')).toContainText(unsavedLine);

    // The editor really does fill the pane: the failure mode when the flex class
    // chain is wrong is a collapsed editor, not a missing one.
    await expect(async () => {
      const paneBox = await single.boundingBox();
      const editorBox = await single.locator('.cm-editor').boundingBox();
      expect(paneBox).not.toBeNull();
      expect(editorBox).not.toBeNull();
      expect(editorBox!.height).toBeGreaterThan(paneBox!.height * 0.6);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'expanded-editor');
    writeNarration(
      screenshotDir,
      step++,
      `The editor now owns the whole pane, and the line we typed came along with it.
The collapse button is still there whenever we want the folder listing back.`
    );

    // --- Phase 3: collapsing returns to the listing, still editing ----------
    await demoClick(expandToggle);

    await expect(listing).toBeVisible({ timeout: 10000 });
    await expect(single).toHaveCount(0);
    // Still editing — collapsing moves the editor, it doesn't close it.
    await expect(saveButton).toBeVisible();
    await expect(listing.locator('.cm-content')).toContainText(unsavedLine);
    await expect(listing.getByText(siblingName, { exact: true })).toBeVisible();
    // Collapsing wrote the preference back off — that is the whole point of the
    // toggle, and it is why Phase 4 has to turn it on again below.
    await expect(expandToggle).toHaveAttribute('title', 'Expand editor');

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'collapsed-back-to-listing');
    writeNarration(
      screenshotDir,
      step++,
      `Collapsing dropped us back into the folder listing with the editor — and our unsaved line — still open.`
    );

    // Expand once more, then cancel from there. This discards the unsaved line
    // AND leaves the preference on, which is the starting state Phase 4 needs.
    // Cancelling is also an exit from the maximized editor in its own right.
    await demoClick(expandToggle);
    await expect(single).toBeVisible({ timeout: 10000 });
    await demoClick(mainWindow.getByTestId('entry-cancel-button'));
    await expect(listing).toBeVisible({ timeout: 10000 });
    await expect(single).toHaveCount(0);
    await expect(saveButton).toHaveCount(0);

    // --- Phase 4: with the preference on, click-to-edit goes straight there --
    await demoClick(targetEntry.getByRole('heading', { name: 'Expand Target' }));

    await expect(single).toBeVisible({ timeout: 10000 });
    await expect(listing).toHaveCount(0);

    const savedLine = 'Saved from the expanded editor.';
    await single.locator('.cm-content').click();
    await mainWindow.keyboard.press('Control+End');
    await mainWindow.keyboard.press('Enter');
    await mainWindow.keyboard.type(savedLine);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'edit-opens-expanded');
    writeNarration(
      screenshotDir,
      step++,
      `With the preference on, clicking a file's body opens it maximized straight away — no toggling needed.`
    );

    await demoClick(saveButton);

    // Saving closes the editor, which returns us to the folder listing.
    await expect(listing).toBeVisible({ timeout: 10000 });
    await expect(single).toHaveCount(0);
    await expect(saveButton).toHaveCount(0);
    await expect(async () => {
      const onDisk = fs.readFileSync(path.join(subPath, targetName), 'utf8');
      expect(onDisk).toContain(savedLine);
      expect(onDisk).not.toContain(unsavedLine);
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'saved-back-to-listing');
    writeNarration(
      screenshotDir,
      step++,
      `Saving wrote the file and handed the pane back to the folder listing. The line we cancelled earlier never reached disk.`
    );

    // (Cancel's exit was already covered before Phase 4.)

    // --- Phase 5: a breadcrumb click mid-edit — the original bug ------------
    // Expanded editing used to be a class chain on the folder listing itself,
    // driven by a scan of the global items map. Navigating away with a file
    // still open for editing left that flag stuck on while the listing fell
    // back to showing every entry, so each row became an equal-share flex item.
    // Now the breadcrumb simply clears single-file mode; the listing it lands on
    // has never heard of editing.
    await demoClick(targetEntry.getByRole('heading', { name: 'Expand Target' }));
    await expect(single).toBeVisible({ timeout: 10000 });

    await demoClick(mainWindow.getByTestId(`breadcrumb-segment-${parentName}`));

    await expect(listing).toBeVisible({ timeout: 10000 });
    await expect(single).toHaveCount(0);
    const rows = listing.getByTestId('browser-entry-markdown');
    await expect(rows).toHaveCount(rowNames.length, { timeout: 10000 });

    // Rows stack directly on top of one another. This is the assertion that
    // catches the bug: each row used to sit in its own `flex-1` wrapper that
    // took an equal share of the pane, so the entries themselves ended up
    // separated by however much dead space the division left over.
    //
    // Deliberately measured as the gap BETWEEN rows rather than as row heights
    // or a fraction of the pane — those depend on how tall the rendered
    // markdown happens to be and on the window size, and would be a flake
    // waiting to happen. The gap is ~0 when correct and ~a third of the pane
    // when not, whatever the content.
    await expect(async () => {
      const boxes = await rows.all().then((rowLocators) => Promise.all(rowLocators.map((r) => r.boundingBox())));
      for (const box of boxes) expect(box).not.toBeNull();
      for (let i = 0; i < boxes.length - 1; i++) {
        const gap = boxes[i + 1]!.y - (boxes[i]!.y + boxes[i]!.height);
        expect(gap).toBeLessThan(8);
      }
    }).toPass({ timeout: 10000 });

    // The header's action buttons are the other half of "not restyled": the
    // maximized editor used to hide them to give itself the space.
    await expect(mainWindow.getByTestId('browser-header-actions')).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'breadcrumb-exit-normal-spacing');
    writeNarration(
      screenshotDir,
      step++,
      `Clicking a breadcrumb while the maximized editor was open took us to the parent folder, whose listing renders exactly as it should — rows stacked tightly, no leftover editor layout.`
    );

    // --- Cleanup -----------------------------------------------------------
    // The seeded files match the my-*.md pattern the next run's cleanup catches,
    // but the folders holding them do not — remove the whole tree.
    fs.rmSync(parentPath, { recursive: true, force: true });

    logScreenshotSummary(screenshotDir);
  });
});
