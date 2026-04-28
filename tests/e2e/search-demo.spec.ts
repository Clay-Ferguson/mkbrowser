import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import { takeStepScreenshot, takeStepScreenshotWithHighlight, writeNarration, demonstrateClickForDemo, insertTextForDemo, logScreenshotSummary, cleanupScreenshots } from './helpers/mediaUtils';

/**
 * E2E Demo Test: Search Feature
 *
 * This test walks through searching inside Federalist Papers content,
 * capturing screenshots and narration at each step for GIF/MP4 generation.
 */
test.describe('Search Demo', () => {
  test('search within federalist papers', async ({ mainWindow }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // Verify initial state — expect to see mkbrowser-test contents
    await expect(mainWindow.getByText('federalist-papers')).toBeVisible({ timeout: 10000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser.
Today we'll be exploring the search feature by searching inside the Federalist Papers content.
You can see the folder listing in front of us, including the federalist-papers folder.`
    );

    // Click the federalist-papers folder
    const federalistFolder = mainWindow.getByText('federalist-papers');
    await takeStepScreenshotWithHighlight(mainWindow, federalistFolder, screenshotDir, step++, 'about-to-click-federalist-folder');
    writeNarration(
      screenshotDir,
      step++,
      `Let's open the federalist-papers folder by clicking on it, so we can search within its contents.`
    );

    await demonstrateClickForDemo(federalistFolder);

    await mainWindow.waitForTimeout(1000);
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'federalist-folder-open');
    writeNarration(
      screenshotDir,
      step++,
      `We're now inside the federalist-papers folder.
We can see the documents listed here.
Now let's use the search feature to find specific content across these files.`
    );

    // Click the search menu button
    const searchMenuButton = mainWindow.getByTestId('search-menu-button');
    await expect(searchMenuButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, searchMenuButton, screenshotDir, step++, 'about-to-click-search-menu');
    writeNarration(
      screenshotDir,
      step++,
      `At the top of the window you can see the search icon.
Let's click it to open the search menu.`
    );

    await demonstrateClickForDemo(searchMenuButton);

    // Click "New Search..." from the popup menu
    const newSearchOption = mainWindow.getByText('New Search...');
    await expect(newSearchOption).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, newSearchOption, screenshotDir, step++, 'search-menu-open');
    writeNarration(
      screenshotDir,
      step++,
      `The search menu has appeared.
We'll click "New Search..." to open the search dialog and define a new query.`
    );

    await demonstrateClickForDemo(newSearchOption);

    // Type search text into the search query input
    const searchInput = mainWindow.getByTestId('search-query-input');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'search-dialog-open');
    writeNarration(
      screenshotDir,
      step++,
      `The search dialog is now open.
We can enter our search term here.
Let's search for the word "political" to find references to that topic across the Federalist Papers.`
    );

    await insertTextForDemo(mainWindow, 'political', true, searchInput);

    await takeStepScreenshotWithHighlight(mainWindow, searchInput, screenshotDir, step++, 'search-text-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We've typed "political" into the search field.
MkBrowser will search through the content of all files in the current folder.
Now let's run the search.`
    );

    // Click the execute search button
    const executeSearchButton = mainWindow.getByTestId('execute-search-button');
    await expect(executeSearchButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, executeSearchButton, screenshotDir, step++, 'about-to-execute-search');
    writeNarration(
      screenshotDir,
      step++,
      `We'll click the Search button to execute the query and find all matching files.`
    );

    await demonstrateClickForDemo(executeSearchButton);

    await mainWindow.waitForTimeout(1500);
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'search-results-visible');
    writeNarration(
      screenshotDir,
      step++,
      `The search results are now displayed.
MkBrowser has found all the files containing the word "political" across the Federalist Papers.
Each result shows the file path and matching context.
Let's click on one of the results to jump directly to that file.`
    );

    // Click the specific result to navigate to that file
    const targetResult = mainWindow.getByText('federalist-03/federalist-03-08.md');
    await expect(targetResult).toBeVisible({ timeout: 10000 });
    await takeStepScreenshotWithHighlight(mainWindow, targetResult, screenshotDir, step++, 'about-to-click-result');
    writeNarration(
      screenshotDir,
      step++,
      `Let's click on the result for federalist-03-08.md to navigate directly to that file in the browser.`
    );

    await demonstrateClickForDemo(targetResult);

    await mainWindow.waitForTimeout(500);
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'file-navigated');
    writeNarration(
      screenshotDir,
      step++,
      `MkBrowser has jumped directly to the federalist-03-08.md file.
The file is now visible in the browser, highlighted so you can see exactly where it appears in its folder.
This is how easy it is to search and navigate to specific content in MkBrowser.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
