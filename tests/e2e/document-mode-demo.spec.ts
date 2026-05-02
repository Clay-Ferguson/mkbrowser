import * as fs from 'fs';
import * as path from 'path';
import { test as baseTest, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demonstrateClickForDemo, logScreenshotSummary, cleanupScreenshots } from './helpers/mediaUtils';

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

    logScreenshotSummary(screenshotDir);
  });
});
