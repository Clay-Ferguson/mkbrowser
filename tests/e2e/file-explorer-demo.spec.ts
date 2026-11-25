// Demo of the Index Tree (file explorer) panel. See: (index_tree.md)
import * as path from 'path';
import { test as baseTest, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demoClick, demoRightClick, findActionBarByFileName, logScreenshotSummary, cleanupScreenshots, resetSettings } from './helpers/mediaUtils';

// Override testDataPath so the app browses the mkbrowser repo itself rather than
// the usual mkbrowser-test fixture folder — this demo needs a real, deeply nested
// folder structure and a real markdown document (USER_GUIDE.md).
// Resolved from __dirname so it works on any clone, at any location.
const test = baseTest.extend({
  // eslint-disable-next-line no-empty-pattern
  testDataPath: async ({}, use) => {
    await use(path.join(__dirname, '../../'));
  },
});

test.describe('File Explorer Tree Demo', () => {
  test('demonstrate file explorer tree navigation', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    await resetSettings(mainWindow);

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // Verify the tree is visible and we are browsing the repo folder
    const tree = mainWindow.getByTestId('file-explorer-tree');
    await expect(tree).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to this quick tour of MK Browser. In this demo we'll look at how the File Explorer Tree works.
The tree panel on the left hand side of the app shows your file system as a navigable hierarchy of folders and files.`
    );

    // --- Click the "docs" folder ---
    const docsFolder = tree.getByText('docs').first();
    await docsFolder.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, docsFolder, screenshotDir, step++, 'about-to-click-docs');
    writeNarration(
      screenshotDir,
      step++,
      `Any folder in the tree can be expanded with a single click.
Here we can see the docs folder. We will click to expand it.`
    );

    await demoClick(docsFolder);
    await mainWindow.waitForTimeout(800);

    // --- Click the "user_guide" folder inside docs ---
    const userGuideFolder = tree.getByText('user_guide', { exact: true }).first();
    await userGuideFolder.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, userGuideFolder, screenshotDir, step++, 'docs-folder-expanded');
    writeNarration(
      screenshotDir,
      step++,
      `Inside docs is the user guide folder. We will expand it too.`
    );

    await demoClick(userGuideFolder);
    await mainWindow.waitForTimeout(800);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'user-guide-folder-expanded');
    writeNarration(
      screenshotDir,
      step++,
      `One of the files listed is the User Guide. We will click on it to open it.`
    );

    // --- Click the "USER_GUIDE.md" file ---
    const userGuideFile = tree.getByText('USER_GUIDE.md').first();
    await userGuideFile.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, userGuideFile, screenshotDir, step++, 'about-to-click-user-guide');
    writeNarration(
      screenshotDir,
      step++,
      `Here is the user guide file in the explorer tree.
We will click on it to open it on its own in the right hand panel.`
    );

    await demoClick(userGuideFile);
    await mainWindow.waitForTimeout(1200);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'user-guide-opened');
    writeNarration(
      screenshotDir,
      step++,
      `The user guide is now open by itself in the right hand panel, ready to read.`
    );

    // --- Phase 2 ---

    // --- Right-click USER_GUIDE.md to open its containing folder on the right ---
    const userGuideFileAgain = tree.getByText('USER_GUIDE.md').first();
    await userGuideFileAgain.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, userGuideFileAgain, screenshotDir, step++, 'about-to-right-click-user-guide');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's try a right click on the user guide in the tree.
Right clicking a file in the tree opens a context menu with several actions you can take on that item.`
    );

    await demoRightClick(userGuideFileAgain);
    await mainWindow.waitForTimeout(1000);

    // The right-click opens a context menu. Verify it appeared and show it off.
    const userGuideBrowseItem = mainWindow.getByTestId('browse-to-folder');
    await expect(userGuideBrowseItem).toBeVisible({ timeout: 5000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'user-guide-context-menu-open');
    writeNarration(
      screenshotDir,
      step++,
      `A context menu has appeared. It offers actions for the selected item, such as renaming, deleting, or pasting.`
    );

    // Highlight the Browse item and mention it, but don't click it: USER_GUIDE.md
    // sits alone in its folder, so browsing there would look the same as the
    // single-file view already on screen.
    await takeScreenshot(mainWindow, userGuideBrowseItem, screenshotDir, step++, 'browse-menu-item');
    writeNarration(
      screenshotDir,
      step++,
      `The Browse item at the top of the menu is another way to get to a folder listing.
It shows the full contents of the folder containing the selected item in the right hand panel.`
    );

    // Dismiss the menu without choosing anything.
    await mainWindow.keyboard.press('Escape');
    await expect(userGuideBrowseItem).toBeHidden({ timeout: 5000 });
    await mainWindow.waitForTimeout(500);

    // --- Phase 3 ---

    // --- Collapse the tree ---
    const collapseButton = mainWindow.getByTestId('file-explorer-tree-collapse');
    await collapseButton.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, collapseButton, screenshotDir, step++, 'about-to-collapse-tree');
    writeNarration(
      screenshotDir,
      step++,
      `Navigation also works in reverse. From any document on the right, you can click to reveal it in the tree.
First, let's collapse the tree completely by clicking the collapse button at the top of the tree panel.`
    );

    await demoClick(collapseButton);
    await mainWindow.waitForTimeout(800);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'tree-collapsed');
    writeNarration(
      screenshotDir,
      step++,
      `The File Explorer Tree is now fully collapsed.
On the right hand side, hovering over a file title reveals a row of action icons. We will click the Reveal in Folder Tree icon on the user guide to locate it in the tree.`
    );

    // --- Click the "Reveal in Folder Tree" button for USER_GUIDE.md ---
    // Walk up from the filename text to the browser-entry-markdown ancestor, then find
    // the action bar inside it — this guarantees we target the correct entry's reveal button.
    const actionBar = findActionBarByFileName(mainWindow, 'USER_GUIDE.md');
    const revealButton = actionBar.getByTestId('entry-reveal-button');
    await demoClick(revealButton, { force: true });
    await mainWindow.waitForTimeout(1200);

    await takeScreenshot(mainWindow, revealButton, screenshotDir, step++, 'file-revealed-in-tree');
    writeNarration(
      screenshotDir,
      step++,
      `The File Explorer Tree has reopened and scrolled to show the user guide file.
Notice that all of the parent folders leading to this file are highlighted in purple in the tree.
This purple coloring always indicates the current item on the right hand side of the app, giving you an instant visual anchor no matter how deeply nested your file is.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
