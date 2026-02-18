import { test, expect } from './fixtures/electronApp';
import { takeStepScreenshot, takeStepScreenshotWithHighlight, writeNarration, demonstrateClickForDemo, insertTextForDemo, logScreenshotSummary } from './helpers/mediaUtils';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E Demo Test: Advanced Search Feature
 *
 * This test walks through using the advanced search mode to run a boolean
 * query against the Federalist Papers content, capturing screenshots and
 * narration at each step for GIF/MP4 generation.
 */
test.describe('Advanced Search Demo', () => {
  test('demonstrate advanced search with boolean query', async ({ mainWindow }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    // Clean and recreate screenshot directory on each run
    fs.rmSync(screenshotDir, { recursive: true, force: true });
    fs.mkdirSync(screenshotDir, { recursive: true });

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // Verify initial state — expect to see mkbrowser-test contents
    await expect(mainWindow.getByText('federalist-papers')).toBeVisible({ timeout: 10000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'initial-view');
    writeNarration(screenshotDir, step++, 'Welcome to MkBrowser. In this demo we will explore the advanced search feature by running a boolean query across the Federalist Papers content. You can see the folder listing in front of us, including the federalist-papers folder.');

    // Highlight and click the federalist-papers folder
    const federalistFolder = mainWindow.getByText('federalist-papers');
    await takeStepScreenshotWithHighlight(mainWindow, federalistFolder, screenshotDir, step++, 'about-to-click-federalist-folder');
    writeNarration(screenshotDir, step++, 'Let\'s open the federalist-papers folder by clicking on it so that our search will be scoped to its contents.');

    await demonstrateClickForDemo(federalistFolder);

    await mainWindow.waitForTimeout(1000);
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'federalist-folder-open');
    writeNarration(screenshotDir, step++, 'We are now inside the federalist-papers folder and can see all of its documents. Now let\'s open the search menu to create a new advanced search.');

    // Open the search menu
    let searchMenuButton = mainWindow.getByTestId('search-menu-button');
    await expect(searchMenuButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, searchMenuButton, screenshotDir, step++, 'about-to-click-search-menu');
    writeNarration(screenshotDir, step++, 'At the top of the window you can see the search icon. Let\'s click it to open the search menu.');

    await demonstrateClickForDemo(searchMenuButton);

    // Click "New Search..." from the popup menu
    const newSearchOption = mainWindow.getByText('New Search...');
    await expect(newSearchOption).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, newSearchOption, screenshotDir, step++, 'search-menu-open');
    writeNarration(screenshotDir, step++, 'The search menu has appeared. We\'ll click "New Search..." to open the search dialog where we can configure our query.');

    await demonstrateClickForDemo(newSearchOption);

    // The search dialog should now be open — select Advanced mode
    const advancedOption = mainWindow.getByTestId('search-type-advanced');
    await expect(advancedOption).toBeVisible({ timeout: 5000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'search-dialog-open');
    writeNarration(screenshotDir, step++, 'The search dialog is open. By default it may be in a simple search mode. We need to switch to Advanced mode so that we can use boolean expressions in our query.');

    await takeStepScreenshotWithHighlight(mainWindow, advancedOption, screenshotDir, step++, 'about-to-click-advanced');
    writeNarration(screenshotDir, step++, 'We\'ll click the "Advanced" option to enable the full boolean query syntax.');

    await demonstrateClickForDemo(advancedOption);

    await mainWindow.waitForTimeout(500);
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'advanced-mode-selected');
    writeNarration(screenshotDir, step++, 'Advanced search mode is now active. We can enter a boolean expression that will be evaluated against each file in the folder.');

    // Type the boolean query into the search query input
    const searchInput = mainWindow.getByTestId('search-query-input');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, searchInput, screenshotDir, step++, 'about-to-enter-query');
    writeNarration(screenshotDir, step++, 'Here is the search query field. We will enter a boolean "and" expression that finds only the files containing both the word "political" and the phrase "free people" at the same time.');

    await insertTextForDemo(mainWindow, '$("political") && $("free people")', true, searchInput);

    await takeStepScreenshotWithHighlight(mainWindow, searchInput, screenshotDir, step++, 'query-entered');
    writeNarration(screenshotDir, step++, 'We have typed the expression dollar-sign "political" and-and dollar-sign "free people". The double-ampersand operator means that both terms must appear in the same file for it to be included in the results.');

    // Enter a name for the saved search
    const searchNameInput = mainWindow.getByTestId('search-name-input');
    await expect(searchNameInput).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, searchNameInput, screenshotDir, step++, 'about-to-enter-name');
    writeNarration(screenshotDir, step++, 'We can also give this search a descriptive name so that it is saved and we can run it again later. Let\'s call it "Political Free People Search".');

    await insertTextForDemo(mainWindow, 'Political Free People Search', true, searchNameInput);

    await takeStepScreenshotWithHighlight(mainWindow, searchNameInput, screenshotDir, step++, 'name-entered');
    writeNarration(screenshotDir, step++, 'The search has been named "Political Free People Search". MkBrowser will remember this search definition so we can reuse it at any time without retyping the query.');

    // Execute the search
    const executeSearchButton = mainWindow.getByTestId('execute-search-button');
    await expect(executeSearchButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, executeSearchButton, screenshotDir, step++, 'about-to-execute-search');
    writeNarration(screenshotDir, step++, 'Everything is set up. Let\'s click the Search button to run the boolean query across the Federalist Papers.');

    await demonstrateClickForDemo(executeSearchButton);

    await mainWindow.waitForTimeout(1500);
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'search-results-visible');
    writeNarration(screenshotDir, step++, 'The search completed successfully. MkBrowser has identified all files in the federalist-papers folder that contain both "political" and "free people", and the matching results are displayed here with their surrounding context.');

    // Click back to the Browse tab so the search icon becomes visible again
    const browseTab = mainWindow.getByTestId('tab-button-browser');
    await expect(browseTab).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, browseTab, screenshotDir, step++, 'about-to-click-browse-tab');
    writeNarration(screenshotDir, step++, 'The search results are showing. To access the search menu again, we first need to switch back to the Browse tab.');

    await demonstrateClickForDemo(browseTab);

    await mainWindow.waitForTimeout(500);
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'back-on-browse-tab');
    writeNarration(screenshotDir, step++, 'We are back in the browser view. The search icon is now visible at the top of the window.');

    // Re-acquire the search menu button reference after tab switch
    searchMenuButton = mainWindow.getByTestId('search-menu-button');

    // Re-open the search menu to show the saved search definition
    await expect(searchMenuButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, searchMenuButton, screenshotDir, step++, 'about-to-open-search-menu-again');
    writeNarration(screenshotDir, step++, 'Now let\'s click the search icon again to see something useful — the saved search definition we just created.');

    await demonstrateClickForDemo(searchMenuButton);

    await mainWindow.waitForTimeout(500);
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'saved-search-visible-in-menu');
    writeNarration(screenshotDir, step++, 'The search menu now shows our saved "Political Free People Search" definition. Any time we want to run that same boolean query again, we can simply click its name in this menu and MkBrowser will re-execute it instantly. That is the power of the advanced search feature in MkBrowser.');

    // Verify the saved search is present in the menu
    await expect(mainWindow.getByText('Political Free People Search')).toBeVisible({ timeout: 5000 });

    logScreenshotSummary(screenshotDir);
  });
});
