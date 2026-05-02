import * as fs from 'fs';
import * as path from 'path';
import { test as baseTest, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demonstrateClickForDemo, logScreenshotSummary, cleanupScreenshots, findActionBarByFileName } from './helpers/mediaUtils';

const federalistPath = '/home/clay/ferguson/projects/mkbrowser/mkbrowser-test/federalist-papers';
const indexYamlPath = `${federalistPath}/.INDEX.yaml`;

// Start the app browsing directly into the federalist-papers folder
const test = baseTest.extend({
  // eslint-disable-next-line no-empty-pattern
  testDataPath: async ({}, use) => {
    await use(federalistPath);
  },
});

test.describe('Document Mode Demo', () => {
  test('demonstrate enabling document mode', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);

    // Delete any existing .INDEX.yaml so the folder starts in non-document mode
    if (fs.existsSync(indexYamlPath)) {
      fs.unlinkSync(indexYamlPath);
    }

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // Guard: confirm we landed in the right folder before proceeding
    await expect(mainWindow.getByText('The Federalist Papers')).toBeVisible({ timeout: 10000 });

    // Verify the sort button is visible (confirms we are in non-document mode)
    const sortMenuButton = mainWindow.getByTestId('sort-menu-button');
    await expect(sortMenuButton).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. In this demo we will be exploring the Document Mode feature using a folder that contains part of the Federalist Papers — a collection of historical political essays. You can see the folder contents listed here, with each file and subfolder representing a section of the document.`
    );

    // Highlight the sort menu button and explain what it does
    await takeScreenshot(mainWindow, sortMenuButton, screenshotDir, step++, 'sort-menu-button-highlighted');
    writeNarration(
      screenshotDir,
      step++,
      `At the top of the content area you can see the sort button. Normally this menu lets you choose how the folder entries are ordered — by filename, creation time, or modification time. But it also gives us access to a more powerful option: enabling Document Mode. Let's click it to open the menu.`
    );

    await demonstrateClickForDemo(sortMenuButton);

    // Wait for the menu to appear, then highlight "Enable Document Mode"
    const enableDocumentModeItem = mainWindow.getByText('Enable Document Mode');
    await expect(enableDocumentModeItem).toBeVisible({ timeout: 5000 });

    await takeScreenshot(mainWindow, enableDocumentModeItem, screenshotDir, step++, 'enable-document-mode-highlighted');
    writeNarration(
      screenshotDir,
      step++,
      `The sort menu is open. At the bottom of the menu you can see the "Enable Document Mode" option. Clicking this will switch this folder into Document Mode, giving us full control over the order in which entries appear. Let's click it now.`
    );

    await demonstrateClickForDemo(enableDocumentModeItem);

    await mainWindow.waitForTimeout(1000);
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'document-mode-enabled');
    writeNarration(
      screenshotDir,
      step++,
      `Document Mode is now enabled for this folder. Notice that the sort button has disappeared from the toolbar — that's because in Document Mode the order of entries is fixed and controlled by you, not by any automatic sort. MkBrowser has created a hidden file called dot-INDEX-dot-yaml in the folder to record and maintain the entry order. There is more to explore about what Document Mode can do, and we will continue in just a moment.`
    );

    // --- Phase 2: Enable Edit Mode and demonstrate move operations ---

    // Find and highlight the Edit Mode checkbox
    const editCheckbox = mainWindow.getByTestId('doc-mode-edit-checkbox');
    await expect(editCheckbox).toBeVisible({ timeout: 5000 });

    await takeScreenshot(mainWindow, editCheckbox, screenshotDir, step++, 'edit-checkbox-highlighted');
    writeNarration(
      screenshotDir,
      step++,
      `Now that Document Mode is active you can see an "Edit" checkbox in the toolbar at the top right. We are going to click this checkbox to turn on Edit Mode for this document, which will unlock additional controls for managing the order and structure of files.`
    );

    await demonstrateClickForDemo(editCheckbox);
    await mainWindow.waitForTimeout(1000);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'edit-mode-enabled');
    writeNarration(
      screenshotDir,
      step++,
      `Edit Mode is now enabled. You can see that "Insert File" and "Insert Folder" buttons have appeared throughout the document, positioned between entries so you can add new content at any specific location in the document order.`
    );

    // Hover over federalist-00.md to reveal its action bar
    const federalist00Entry = mainWindow
      .getByTestId('browser-entry-markdown')
      .filter({ has: mainWindow.locator('text="federalist-00.md"') })
      .first();
    await federalist00Entry.hover();
    await mainWindow.waitForTimeout(500);

    // Find the Move Down button using the same technique as the reveal button pattern
    const actionBar00 = findActionBarByFileName(mainWindow, 'federalist-00.md');
    const moveDownButton = actionBar00.getByTestId('entry-move-down-button');

    await takeScreenshot(mainWindow, moveDownButton, screenshotDir, step++, 'move-down-button-highlighted');
    writeNarration(
      screenshotDir,
      step++,
      `Hovering over a file header reveals a row of action icons on the right-hand side. Here we can see the "Move Down" arrow button highlighted for the file "federalist-00.md". We are about to click it to move this file down one position in the document order.`
    );

    await demonstrateClickForDemo(moveDownButton, { force: true });
    await mainWindow.waitForTimeout(1000);

    const federalist00EntryMoved = mainWindow
      .getByTestId('browser-entry-markdown')
      .filter({ has: mainWindow.locator('text="federalist-00.md"') })
      .first();

    await takeScreenshot(mainWindow, federalist00EntryMoved, screenshotDir, step++, 'file-moved-down');
    writeNarration(
      screenshotDir,
      step++,
      `We can now see that "federalist-00.md" has been moved down one position in the document. The file order in Document Mode is entirely under your control — just click the arrow buttons to reposition any file.`
    );

    // Hover again to reveal action buttons for the move-up operation
    await federalist00EntryMoved.hover();
    await mainWindow.waitForTimeout(500);

    const actionBar00Again = findActionBarByFileName(mainWindow, 'federalist-00.md');
    const moveUpButton = actionBar00Again.getByTestId('entry-move-up-button');

    await takeScreenshot(mainWindow, moveUpButton, screenshotDir, step++, 'move-up-button-highlighted');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's move it back up to where it was. We can see the "Move Up" arrow button highlighted in the action bar. We are going to click it to restore the file to its original position at the top of the list.`
    );

    await demonstrateClickForDemo(moveUpButton, { force: true });
    await mainWindow.waitForTimeout(1000);

    const federalist00EntryRestored = mainWindow
      .getByTestId('browser-entry-markdown')
      .filter({ has: mainWindow.locator('text="federalist-00.md"') })
      .first();

    await takeScreenshot(mainWindow, federalist00EntryRestored, screenshotDir, step++, 'file-moved-back-up');
    writeNarration(
      screenshotDir,
      step++,
      `And there we have it — "federalist-00.md" is back at the top where it started. Document Mode gives you full, intuitive control over how your documents are ordered. There is more to explore, and we will continue in just a moment.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
