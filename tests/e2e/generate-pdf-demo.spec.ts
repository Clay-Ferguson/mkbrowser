import { test, expect } from './fixtures/electronApp';
import { takeStepScreenshot, takeStepScreenshotWithHighlight, writeNarration, demonstrateClickForDemo, setCheckboxForDemo, insertTextForDemo, logScreenshotSummary } from './helpers/mediaUtils';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E Demo Test: Generate PDF Feature
 *
 * This test walks through using the Export dialog to generate a PDF from
 * the Federalist Papers content, capturing screenshots and narration at
 * each step for GIF/MP4 generation.
 */
test.describe('Generate PDF Demo', () => {
  test('demonstrate exporting a folder to PDF', async ({ mainWindow }) => {
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
    writeNarration(screenshotDir, step++, 'Welcome to MkBrowser. In this demo we will generate a PDF from the Federalist Papers content. You can see the folder listing in front of us, including the federalist-papers folder that holds all of the documents we want to export.');

    // Highlight and click the federalist-papers folder
    const federalistFolder = mainWindow.getByText('federalist-papers');
    await takeStepScreenshotWithHighlight(mainWindow, federalistFolder, screenshotDir, step++, 'about-to-click-federalist-folder');
    writeNarration(screenshotDir, step++, 'Let\'s open the federalist-papers folder by clicking on it. This will navigate into the folder so that our export covers just its contents.');

    await demonstrateClickForDemo(federalistFolder);

    await mainWindow.waitForTimeout(1000);
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'federalist-folder-open');
    writeNarration(screenshotDir, step++, 'We are now inside the federalist-papers folder. You can see all of its documents listed here. Now let\'s open the Tools menu to access the Export feature.');

    // Click the Tools menu button
    const toolsMenuButton = mainWindow.getByTestId('tools-menu-button');
    await expect(toolsMenuButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, toolsMenuButton, screenshotDir, step++, 'about-to-click-tools-menu');
    writeNarration(screenshotDir, step++, 'At the top of the window you can see the Tools menu button. Let\'s click it to open the available tools for this folder.');

    await demonstrateClickForDemo(toolsMenuButton);

    // Click "Export..." from the dropdown menu
    const exportOption = mainWindow.getByText('Export...');
    await expect(exportOption).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, exportOption, screenshotDir, step++, 'tools-menu-open');
    writeNarration(screenshotDir, step++, 'The Tools menu is open. We can see the Export option here. Let\'s click it to open the Export dialog where we can configure our output settings.');

    await demonstrateClickForDemo(exportOption);

    // The Export dialog should now be open
    const outputFolderInput = mainWindow.getByTestId('export-output-folder');
    await expect(outputFolderInput).toBeVisible({ timeout: 5000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'export-dialog-open');
    writeNarration(screenshotDir, step++, 'The Export dialog has appeared. Here we can configure where our output will be saved, the name of the file, and several options that control how MkBrowser assembles the exported document.');

    // Fill in the Output Folder field
    await takeStepScreenshotWithHighlight(mainWindow, outputFolderInput, screenshotDir, step++, 'about-to-enter-output-folder');
    writeNarration(screenshotDir, step++, 'First, let\'s set the output folder. We\'ll type a path where MkBrowser will write the exported files.');

    await insertTextForDemo(mainWindow, '/home/clay/exports', true, outputFolderInput);

    await takeStepScreenshotWithHighlight(mainWindow, outputFolderInput, screenshotDir, step++, 'output-folder-entered');
    writeNarration(screenshotDir, step++, 'We\'ve entered "/home/clay/exports" as the output folder. Next, let\'s enter a name for the exported file.');

    // Fill in the File Name field
    const fileNameInput = mainWindow.getByTestId('export-file-name');
    await expect(fileNameInput).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, fileNameInput, screenshotDir, step++, 'about-to-enter-file-name');
    writeNarration(screenshotDir, step++, 'Now we\'ll fill in the File Name field with a descriptive name for our exported file.');

    await insertTextForDemo(mainWindow, 'federalist-papers.md', true, fileNameInput);

    await takeStepScreenshotWithHighlight(mainWindow, fileNameInput, screenshotDir, step++, 'file-name-entered');
    writeNarration(screenshotDir, step++, 'We\'ve entered "federalist-papers.md" as the filename. Now let\'s look at the export options and enable all of them for our demo.');

    // Click all four checkboxes
    const includeSubfolders = mainWindow.getByTestId('export-include-subfolders');
    const includeFilenames = mainWindow.getByTestId('export-include-filenames');
    const includeDividers = mainWindow.getByTestId('export-include-dividers');
    const exportToPdf = mainWindow.getByTestId('export-to-pdf');

    await expect(includeSubfolders).toBeVisible({ timeout: 5000 });

    await takeStepScreenshotWithHighlight(mainWindow, includeSubfolders, screenshotDir, step++, 'about-to-click-checkboxes');
    writeNarration(screenshotDir, step++, 'There are four checkboxes controlling extra export options. We\'ll click all four of them to enable including subfolders, file name headers, section dividers, and PDF conversion.');

    await setCheckboxForDemo(includeSubfolders, true);
    await setCheckboxForDemo(includeFilenames, true);
    await setCheckboxForDemo(includeDividers, true);
    await setCheckboxForDemo(exportToPdf, true);

    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'checkboxes-selected');
    writeNarration(screenshotDir, step++, 'All four options are now checked. MkBrowser will include subfolders, add each file\'s name as a heading, insert dividers between sections, and convert the result directly to a PDF file.');

    // Click the Export button
    const exportSubmitButton = mainWindow.getByTestId('export-submit-button');
    await expect(exportSubmitButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, exportSubmitButton, screenshotDir, step++, 'about-to-click-export');
    writeNarration(screenshotDir, step++, 'Everything is configured. Let\'s click the Export button to kick off the export process.');

    await demonstrateClickForDemo(exportSubmitButton);

    await mainWindow.waitForTimeout(1500);
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'export-launched');
    writeNarration(screenshotDir, step++, 'MkBrowser has launched an external terminal window to run the export. You would see that terminal processing the files and converting them to a PDF. Once it finishes, you can navigate to the output folder at "/home/clay/exports" to find the completed PDF file. That\'s all there is to it — MkBrowser makes it easy to compile and export an entire folder of documents to a polished PDF in just a few clicks.');

    logScreenshotSummary(screenshotDir);
  });
});
