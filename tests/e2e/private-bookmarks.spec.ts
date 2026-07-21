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
 * Private E2E Test: Bookmarks
 *
 * Exercises the full bookmarks lifecycle:
 *   1. Seeds a folder (with a file inside) and a standalone markdown file.
 *   2. Adds a bookmark to the folder via the entry action bar, accepting the
 *      default name from the naming dialog.
 *   3. Adds a bookmark to the file, this time typing a custom display name.
 *   4. Navigates into the folder, then jumps back out using the file bookmark
 *      from the Index Tree panel's bookmarks menu.
 *   5. Renames a bookmark from the menu's pencil button.
 *   6. Deletes a bookmark from the menu's trash button.
 *   7. Removes the last bookmark by clicking the solid icon on the entry itself
 *      (immediate, no confirmation), and confirms the menu is empty.
 *
 * This test is private (not part of the demo video set) — it still writes
 * screenshots/narration to follow the shared conventions, but its primary
 * purpose is automated verification of the bookmarks feature. Each run launches
 * with a fresh seeded user-data dir, so bookmarks always start empty.
 */
test.describe('Private: Bookmarks', () => {
  test('add, navigate, rename, and delete bookmarks', async ({ mainWindow, testDataPath }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // Seed a folder with a file inside it (so navigating to the folder bookmark
    // shows something) plus a standalone file to bookmark. cleanupTestDataFiles()
    // removes my-*.md recursively but not folders, so remove and recreate the
    // folder here for a clean slate.
    const folderName = 'my-bookmark-folder';
    const folderPath = path.join(testDataPath, folderName);
    fs.rmSync(folderPath, { recursive: true, force: true });
    fs.mkdirSync(folderPath);

    const insideFileName = 'my-inside-note.md';
    fs.writeFileSync(
      path.join(folderPath, insideFileName),
      `# ${insideFileName}\n\nThis note lives inside the bookmarked folder.\n`
    );

    const fileName = 'my-bookmark-note.md';
    fs.writeFileSync(
      path.join(testDataPath, fileName),
      `# ${fileName}\n\nThis standalone file will be bookmarked with a custom name.\n`
    );

    // The custom display name we give the file bookmark, plus the name the folder
    // bookmark is later renamed to. These strings are embedded verbatim into the
    // menu's dynamic test IDs.
    const fileBookmarkName = 'My Favorite Note';
    const renamedFolderBookmark = 'Project Home';

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // The files were written after the app read the folder, so refresh.
    await demoClick(mainWindow.getByTestId('refresh-button'));

    const mainContent = mainWindow.getByTestId('browser-main-content');
    await expect(mainContent.getByText(folderName, { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(mainContent.getByText(fileName).first()).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. Today we're looking at bookmarks, which let you pin any folder or file so you can jump straight back to it later, no matter where you've navigated.
Here we have a folder and a markdown file in our workspace — let's create a couple of bookmarks.`
    );

    // The action-bar icons fade in on hover with a delay (EntryActionBar.tsx:
    // 400ms delay + 200ms opacity transition), so after every hover we must
    // wait for the fade to finish or screenshots capture invisible icons.
    const hoverRevealMs = 700;

    // --- Bookmark the folder ---
    // The folder entry is a hover-revealed action bar; find its row, hover to
    // reveal the icons, then use the bookmark toggle.
    const folderRow = mainContent.locator('div.group').filter({ hasText: folderName }).first();
    await folderRow.hover();
    await mainWindow.waitForTimeout(hoverRevealMs);
    const folderBookmarkButton = folderRow.getByTestId('entry-action-bar').getByTestId('entry-bookmark-button');
    await expect(folderBookmarkButton).toHaveAttribute('title', 'Add bookmark');

    await takeScreenshot(mainWindow, folderBookmarkButton, screenshotDir, step++, 'about-to-bookmark-folder');
    writeNarration(
      screenshotDir,
      step++,
      `Hovering over the folder reveals a row of action icons.
The bookmark icon is the hollow ribbon. Let's click it to bookmark this folder.`
    );

    await demoClick(folderBookmarkButton, { force: true });

    // The naming dialog appears, pre-filled with the folder's name.
    const nameInput = mainWindow.getByTestId('bookmark-name-input');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue(folderName);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'folder-bookmark-dialog');
    writeNarration(
      screenshotDir,
      step++,
      `A dialog asks what to call the bookmark, pre-filled with the folder's name.
We can accept the default name or type our own. For the folder, we'll keep the default.`
    );

    await demoClick(mainWindow.getByTestId('bookmark-dialog-save-button'));

    // The entry's bookmark icon turns solid; its title flips to "Remove bookmark".
    await expect(folderBookmarkButton).toHaveAttribute('title', 'Remove bookmark');

    // The mouse moved to the dialog's Save button, so the action bar has faded
    // out again — re-hover so the now-solid icon is visible in the screenshot.
    await folderRow.hover();
    await mainWindow.waitForTimeout(hoverRevealMs);
    await takeScreenshot(mainWindow, folderBookmarkButton, screenshotDir, step++, 'folder-bookmarked');
    writeNarration(
      screenshotDir,
      step++,
      `The folder is now bookmarked — notice the ribbon icon has turned solid blue.
That solid icon is your at-a-glance indicator that an item is already bookmarked.`
    );

    // --- Bookmark the file, with a custom name ---
    const fileActionBar = findActionBarByFileName(mainContent, fileName);
    await fileActionBar.hover();
    await mainWindow.waitForTimeout(hoverRevealMs);
    const fileBookmarkButton = fileActionBar.getByTestId('entry-bookmark-button');
    await expect(fileBookmarkButton).toHaveAttribute('title', 'Add bookmark');

    await takeScreenshot(mainWindow, fileBookmarkButton, screenshotDir, step++, 'about-to-bookmark-file');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's bookmark the markdown file the same way, by clicking the bookmark icon in its action bar.`
    );

    await demoClick(fileBookmarkButton, { force: true });

    await expect(nameInput).toBeVisible();
    // This time, replace the default with a friendlier custom label.
    await nameInput.fill(fileBookmarkName);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'file-bookmark-dialog-custom-name');
    writeNarration(
      screenshotDir,
      step++,
      `This time we'll give the bookmark a custom display name instead of the raw filename.
We've typed "${fileBookmarkName}" — a bookmark's name is just a friendly label and doesn't rename the file itself.`
    );

    await demoClick(mainWindow.getByTestId('bookmark-dialog-save-button'));
    await expect(fileBookmarkButton).toHaveAttribute('title', 'Remove bookmark');

    // Re-hover after the dialog click so the solid icon is visible again.
    await fileActionBar.hover();
    await mainWindow.waitForTimeout(hoverRevealMs);
    await takeScreenshot(mainWindow, fileBookmarkButton, screenshotDir, step++, 'file-bookmarked');
    writeNarration(
      screenshotDir,
      step++,
      `Both items are now bookmarked. Next, let's see how bookmarks help us navigate.`
    );

    // --- Navigate into the folder so our location differs from the root ---
    await demoClick(mainContent.getByText(folderName, { exact: true }));
    await expect(mainContent.getByText(insideFileName).first()).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'inside-folder');
    writeNarration(
      screenshotDir,
      step++,
      `We've navigated into the folder, and we can see the note that lives inside it.
Now we're somewhere other than where we started — the perfect moment to use a bookmark to jump elsewhere.`
    );

    // --- Open the bookmarks menu from the Index Tree panel ---
    const bookmarksMenuButton = mainWindow.getByTestId('bookmarks-menu-button');
    await demoClick(bookmarksMenuButton);

    const folderBookmarkItem = mainWindow.getByTestId(`bookmark-item-${folderName}`);
    const fileBookmarkItem = mainWindow.getByTestId(`bookmark-item-${fileBookmarkName}`);
    await expect(folderBookmarkItem).toBeVisible();
    await expect(fileBookmarkItem).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'bookmarks-menu-open');
    writeNarration(
      screenshotDir,
      step++,
      `The bookmarks menu, opened from the top of the file tree panel, lists both of our bookmarks.
They're sorted alphabetically by their display name, so you can always find them in a predictable order.`
    );

    // --- Navigate via the file bookmark (jumps back out to the root) ---
    await takeScreenshot(mainWindow, fileBookmarkItem, screenshotDir, step++, 'about-to-navigate-via-bookmark');
    writeNarration(
      screenshotDir,
      step++,
      `Let's click the "${fileBookmarkName}" bookmark to jump straight to that file, even though we're currently inside a different folder.`
    );

    await demoClick(fileBookmarkItem);

    // A bookmarked *file* opens in single-file browsing, so BrowseView (and its
    // 'browser-main-content') is swapped out for BrowseFile entirely — assert
    // against the single-file pane, not `mainContent`.
    const singleFile = mainWindow.getByTestId('browse-file-main-content');
    await expect(singleFile.getByText(fileName).first()).toBeVisible({ timeout: 10000 });
    // The sibling file in the other folder is not merely off-screen: nothing
    // but the bookmarked file is rendered in this mode.
    await expect(singleFile.getByText(insideFileName)).toHaveCount(0);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'navigated-via-bookmark');
    writeNarration(
      screenshotDir,
      step++,
      `In one click, the app opened our bookmarked file on its own, with nothing else competing for the view.
Bookmarks are a fast way to teleport around your workspace. Click any breadcrumb above the file to return to the folder listing.`
    );

    // Back to the folder listing — the remaining steps drive the file's entry
    // action bar, which is scoped to BrowseView's `mainContent`. The home
    // button is the exit from single-file mode and lands on the root, which is
    // where the bookmarked file lives.
    await demoClick(
      mainWindow.getByTestId('browse-file-header-breadcrumbs').getByTestId('breadcrumb-home-button')
    );
    await expect(mainContent.getByText(fileName).first()).toBeVisible({ timeout: 10000 });

    // --- Rename the folder bookmark from the menu ---
    await demoClick(bookmarksMenuButton);
    // The row's pencil/trash icons are hover-revealed too (a quick opacity
    // fade, no delay) — a short settle keeps them visible in the screenshot.
    await folderBookmarkItem.hover();
    await mainWindow.waitForTimeout(300);
    const folderEditButton = mainWindow.getByTestId(`bookmark-edit-button-${folderName}`);
    await takeScreenshot(mainWindow, folderEditButton, screenshotDir, step++, 'about-to-rename-bookmark');
    writeNarration(
      screenshotDir,
      step++,
      `Bookmarks can be renamed at any time. Hovering a row reveals a pencil and a trash icon.
Let's click the pencil on the folder bookmark to rename it.`
    );

    await demoClick(folderEditButton, { force: true });

    // The rename flow reuses the bookmark dialog inputs, pre-filled with the old name.
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue(folderName);
    await nameInput.fill(renamedFolderBookmark);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'renaming-bookmark');
    writeNarration(
      screenshotDir,
      step++,
      `The edit dialog opens with the current name. We'll change it to "${renamedFolderBookmark}" and save.`
    );

    await demoClick(mainWindow.getByTestId('bookmark-dialog-save-button'));

    // The menu now shows the new name and no longer the old one.
    await expect(mainWindow.getByTestId(`bookmark-item-${renamedFolderBookmark}`)).toBeVisible();
    await expect(mainWindow.getByTestId(`bookmark-item-${folderName}`)).toHaveCount(0);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'bookmark-renamed');
    writeNarration(
      screenshotDir,
      step++,
      `The folder bookmark now shows as "${renamedFolderBookmark}" in the menu.
The folder on disk is untouched — only the bookmark's label changed.`
    );

    // --- Delete the renamed bookmark from the menu ---
    const renamedBookmarkItem = mainWindow.getByTestId(`bookmark-item-${renamedFolderBookmark}`);
    await renamedBookmarkItem.hover();
    await mainWindow.waitForTimeout(300);
    const renamedDeleteButton = mainWindow.getByTestId(`bookmark-delete-button-${renamedFolderBookmark}`);
    await takeScreenshot(mainWindow, renamedDeleteButton, screenshotDir, step++, 'about-to-delete-bookmark');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's remove that bookmark using the trash icon on its row.`
    );

    await demoClick(renamedDeleteButton, { force: true });

    // It disappears from the menu; the file bookmark remains.
    await expect(renamedBookmarkItem).toHaveCount(0);
    await expect(fileBookmarkItem).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'bookmark-deleted-from-menu');
    writeNarration(
      screenshotDir,
      step++,
      `The bookmark is gone from the menu, while our file bookmark is still there.
Deleting a bookmark never touches the underlying file or folder — it only removes the shortcut.`
    );

    // Close the menu before interacting with the entry action bar.
    await mainWindow.keyboard.press('Escape');
    await expect(fileBookmarkItem).toHaveCount(0);

    // --- Remove the last bookmark from the entry itself (no dialog) ---
    await fileActionBar.hover();
    await mainWindow.waitForTimeout(hoverRevealMs);
    await expect(fileBookmarkButton).toHaveAttribute('title', 'Remove bookmark');
    await takeScreenshot(mainWindow, fileBookmarkButton, screenshotDir, step++, 'about-to-unbookmark-file');
    writeNarration(
      screenshotDir,
      step++,
      `Finally, we can remove a bookmark right from the item's own action bar.
Clicking a solid bookmark icon removes the bookmark immediately — no dialog, no confirmation.`
    );

    await demoClick(fileBookmarkButton, { force: true });

    // The icon flips back to the hollow "Add bookmark" state with no dialog.
    await expect(fileBookmarkButton).toHaveAttribute('title', 'Add bookmark');
    await expect(mainWindow.getByTestId('bookmark-name-input')).toHaveCount(0);

    // Reopen the menu and confirm it is now empty.
    await demoClick(bookmarksMenuButton);
    await expect(mainWindow.getByText('No bookmarks')).toBeVisible();

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'no-bookmarks-left');
    writeNarration(
      screenshotDir,
      step++,
      `The bookmark icon is hollow again, and the bookmarks menu shows "No bookmarks".
We've now added, navigated, renamed, and deleted bookmarks — the full lifecycle.`
    );

    // Close the menu.
    await mainWindow.keyboard.press('Escape');

    // --- Cleanup ---
    // my-*.md files are caught by cleanupTestDataFiles(), but unlink them anyway,
    // and remove the seeded folder (cleanup does not remove folders).
    fs.rmSync(path.join(testDataPath, fileName), { force: true });
    fs.rmSync(folderPath, { recursive: true, force: true });

    logScreenshotSummary(screenshotDir);
  });
});
