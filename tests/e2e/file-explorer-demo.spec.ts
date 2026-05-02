import * as path from 'path';
import { test as baseTest, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demonstrateClickForDemo, demonstrateRightClickForDemo, findActionBarByFileName, logScreenshotSummary, cleanupScreenshots } from './helpers/mediaUtils';

// Override testDataPath so the app starts browsing /home/clay/ferguson
const test = baseTest.extend({
  // eslint-disable-next-line no-empty-pattern
  testDataPath: async ({}, use) => {
    await use('/home/clay/ferguson');
  },
});

test.describe('File Explorer Tree Demo', () => {
  test('demonstrate file explorer tree navigation', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // Verify the tree is visible and we are browsing /home/clay/ferguson
    const tree = mainWindow.getByTestId('file-explorer-tree');
    await expect(tree).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. In this demo we'll look at how the File Explorer Tree works.
The tree panel on the left-hand side of the app shows your file system as a navigable hierarchy of folders and files.`
    );

    // --- Click the "projects" folder ---
    const projectsFolder = tree.getByText('projects').first();
    await projectsFolder.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, projectsFolder, screenshotDir, step++, 'about-to-click-projects');
    writeNarration(
      screenshotDir,
      step++,
      `Let's click the projects folder to expand it.`
    );

    await demonstrateClickForDemo(projectsFolder);
    await mainWindow.waitForTimeout(800);

    // await takeScreenshot(mainWindow, null, screenshotDir, step++, 'projects-folder-expanded');
    // writeNarration(
    //   screenshotDir,
    //   step++,
    //   `Next, let's open the mkbrowser folder.`
    // );

    // --- Click the "mkbrowser" folder ---
    const mkbrowserFolder = tree.getByText('mkbrowser').first();
    await mkbrowserFolder.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, mkbrowserFolder, screenshotDir, step++, 'about-to-click-mkbrowser');
    writeNarration(
      screenshotDir,
      step++,
      `Next we'll expand the mkbrowser folder.`
    );

    await demonstrateClickForDemo(mkbrowserFolder);
    await mainWindow.waitForTimeout(800);

    // await takeScreenshot(mainWindow, null, screenshotDir, step++, 'mkbrowser-folder-expanded');
    // writeNarration(
    //   screenshotDir,
    //   step++,
    //   `Now let's open the docs folder.`
    // );

    // --- Click the "docs" folder ---
    const docsFolder = tree.getByText('docs').first();
    await docsFolder.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, docsFolder, screenshotDir, step++, 'about-to-click-docs');
    writeNarration(
      screenshotDir,
      step++,
      `Here we can see the docs folder. Let's click to expand it.`
    );

    await demonstrateClickForDemo(docsFolder);
    await mainWindow.waitForTimeout(800);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'docs-folder-expanded');
    writeNarration(
      screenshotDir,
      step++,
      `One of the files listed is the User Guide. Let's click on it to see something special — MkBrowser can expand markdown files to show their heading structure right inside the tree.`
    );

    // --- Click the "USER_GUIDE.md" file ---
    const userGuideFile = tree.getByText('USER_GUIDE.md').first();
    await userGuideFile.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, userGuideFile, screenshotDir, step++, 'about-to-click-user-guide');
    writeNarration(
      screenshotDir,
      step++,
      `Here is the user guide file in the explorer tree.
Let's click on it to expand it and reveal its internal heading structure.`
    );

    await demonstrateClickForDemo(userGuideFile);
    await mainWindow.waitForTimeout(1200);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'user-guide-expanded-headings');
    writeNarration(
      screenshotDir,
      step++,
      `The markdown file has expanded to show its heading structure directly inside the File Explorer Tree.
Each heading from the document appears as a clickable node, letting you right-click to jump straight to any section of the file without scrolling.
This is one of the most powerful navigation features of MkBrowser.`
    );

    // --- Phase 2 ---

    // Silently scroll the "Searching" heading into view before interacting with it
    const searchingHeading = tree.getByText('Searching').first();
    await searchingHeading.scrollIntoViewIfNeeded();
    await mainWindow.waitForTimeout(500);

    // --- Right-click USER_GUIDE.md to open its containing folder on the right ---
    const userGuideFileAgain = tree.getByText('USER_GUIDE.md').first();
    await userGuideFileAgain.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, userGuideFileAgain, screenshotDir, step++, 'about-to-right-click-user-guide');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's try a right-click on the user guide in the tree.
Right-clicking a file opens its containing folder in the main content area on the right-hand side of the app.`
    );

    await demonstrateRightClickForDemo(userGuideFileAgain);
    await mainWindow.waitForTimeout(1000);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'right-click-user-guide-folder-opened');
    writeNarration(
      screenshotDir,
      step++,
      `The right-hand panel has navigated to the folder containing the user guide.
You can see the file listing for the docs folder on the right side.`
    );

    // --- Click the "Searching" heading to expand its sub-headings ---
    await searchingHeading.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, searchingHeading, screenshotDir, step++, 'about-to-click-searching-heading');
    writeNarration(
      screenshotDir,
      step++,
      `Back in the File Explorer Tree we can see the headings in the user guide.
Let's click on the "Searching" heading to expand it and reveal its sub-headings inside the tree.`
    );

    await demonstrateClickForDemo(searchingHeading);
    await mainWindow.waitForTimeout(800);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'searching-heading-expanded');
    writeNarration(
      screenshotDir,
      step++,
      `The Searching heading is now expanded and its sub-headings are visible in the tree.
We can drill into any section of the document directly from the file explorer.`
    );

    // --- Right-click "Saving Search Definitions" sub-heading ---
    const savingSearchNode = tree.getByText('Saving Search Definitions').first();
    await savingSearchNode.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, savingSearchNode, screenshotDir, step++, 'about-to-right-click-saving-search-definitions');
    writeNarration(
      screenshotDir,
      step++,
      `We can see the sub-heading "Saving Search Definitions" in the tree.
Let's right-click it — this should scroll the right-hand side of the app directly to that section of the document.`
    );

    await demonstrateRightClickForDemo(savingSearchNode);
    await mainWindow.waitForTimeout(1200);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'right-click-saving-search-definitions-scrolled');
    writeNarration(
      screenshotDir,
      step++,
      `The right-hand panel has scrolled directly to the "Saving Search Definitions" section of the USER_GUIDE document.
Right-clicking any heading in the File Explorer Tree is a fast way to jump to that exact section in the reader.`
    );

    // --- Phase 3 ---

    // --- Collapse the tree ---
    const collapseButton = mainWindow.getByTestId('file-explorer-tree-collapse');
    await collapseButton.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, collapseButton, screenshotDir, step++, 'about-to-collapse-tree');
    writeNarration(
      screenshotDir,
      step++,
      `We just jumped from the File Explorer Tree directly to a section in the document.
But navigation also works in reverse — from any document on the right, you can jump back to find it in the tree.
First, let's collapse the tree completely by clicking the collapse button at the top of the tree panel.`
    );

    await demonstrateClickForDemo(collapseButton);
    await mainWindow.waitForTimeout(800);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'tree-collapsed');
    writeNarration(
      screenshotDir,
      step++,
      `The File Explorer Tree is now fully collapsed and out of the way.
Now let's scroll the right-hand panel back to the top so we can access the file controls.`
    );

    // --- Scroll the main content panel to the top ---
    const mainContent = mainWindow.getByTestId('browser-main-content');
    await mainContent.evaluate((el) => el.scrollTo({ top: 0}));
    await mainWindow.waitForTimeout(800);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'main-content-scrolled-to-top');
    writeNarration(
      screenshotDir,
      step++,
      `The content panel is scrolled back to the top and we can see the file header for user guide file.
Hovering over a file title reveals a row of action icons. Let's click the "Reveal in Folder Tree" icon to locate this file in the tree.`
    );

    // --- Click the "Reveal in Folder Tree" button for USER_GUIDE.md ---
    // Walk up from the filename text to the browser-entry-markdown ancestor, then find
    // the action bar inside it — this guarantees we target the correct entry's reveal button.
    const actionBar = findActionBarByFileName(mainWindow, 'USER_GUIDE.md');
    const revealButton = actionBar.getByTestId('entry-reveal-button');
    // todo-0: Try to get this 'revealButton' to show up highlighted in the screenshot. So far this has failed. &&&
    //         HINT: i think the problem is that we need to be calling takeScreenshot instead of takeScreenshot
    //               at this step and probably for many other places where we take a screenshots, threw out all of our test cases because 
    //               lots of the time we will have something that we just clicked on which we're taking a screenshot of, 
    //               unless we just changed to a new page and haven't clicked on anything yet in the demo 
    await demonstrateClickForDemo(revealButton, { force: true });
    await mainWindow.waitForTimeout(1200);

    await takeScreenshot(mainWindow, revealButton, screenshotDir, step++, 'file-revealed-in-tree');
    writeNarration(
      screenshotDir,
      step++,
      `The File Explorer Tree has re-opened and scrolled to show the user guide file.
Notice that all of the parent folders leading to this file are highlighted in purple in the tree.
This purple coloring always indicates the current item on the right-hand side of the app, giving you an instant visual anchor no matter how deeply nested your file is.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
