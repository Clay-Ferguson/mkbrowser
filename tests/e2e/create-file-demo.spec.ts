import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demonstrateClickForDemo, insertTextForDemo, logScreenshotSummary, cleanupScreenshots, cleanupTestDataFiles } from './helpers/mediaUtils';

/**
 * E2E Demo Test with Visual Indicators
 * 
 * This test runs through the workflow of creating a new file, entering content, 
 * and saving, while capturing each step with annotated screenshots and narration text files.
 */
test.describe('Create File Demo', () => {
  test('complete workflow with visual indicators', async ({ mainWindow }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // Verify files are visible
    const mainContent = mainWindow.getByTestId('browser-main-content');
    await expect(mainContent.getByText('sample.md').first()).toBeVisible({ timeout: 10000 });
    await expect(mainContent.getByText('readme.txt').first()).toBeVisible();
    await expect(mainContent.getByText('notes.md').first()).toBeVisible();
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'files-visible');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser.
Here we can see our files displayed in a browsable list.
Markdown files are rendered inline, and we can create, edit, and organize files right from this interface.
Let's create a new file to see how it works.`
    );

    // Demonstrate clicking the create file button
    const createButton = mainWindow.getByTestId('create-file-button');

    // Highlight and click with proper timing to capture screenshot
    await takeScreenshot(mainWindow, createButton, screenshotDir, step++, 'about-to-click-create');
    writeNarration(
      screenshotDir,
      step++,
      `We'll click the Create File button at the top of the window to add a new file to our folder.`
    );

    await demonstrateClickForDemo(createButton);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'create-dialog-open');
    writeNarration(
      screenshotDir,
      step++,
      `The Create File dialog has appeared.
We can enter a custom filename here.
Let's type a descriptive name for our new file.`
    );

    // Demonstrate typing a filename
    const filenameInput = mainWindow.getByTestId('create-file-dialog-input');
    await insertTextForDemo(mainWindow, 'my-journal-entry', true, filenameInput);

    await takeScreenshot(mainWindow, filenameInput, screenshotDir, step++, 'filename-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We've entered "my-journal-entry" as the filename.
Notice we didn't include a file extension — MkBrowser will automatically add ".md" to make it a Markdown file.`
    );

    // Demonstrate clicking the Create button in dialog
    const createDialogButton = mainWindow.getByTestId('create-file-dialog-create-button');
    await takeScreenshot(mainWindow, createDialogButton, screenshotDir, step++, 'about-to-create-file');
    writeNarration(
      screenshotDir,
      step++,
      `Now we'll click the Create button to confirm and create the file.`
    );

    await demonstrateClickForDemo(createDialogButton);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'new-file-created');
    writeNarration(
      screenshotDir,
      step++,
      `Our new file has been created and is now open in edit mode.
Notice the text editor that appeared — this is a full-featured code editor where we can write Markdown content.`
    );

    // Demonstrate typing with visual highlight on the focused input area
    await insertTextForDemo(mainWindow, 'this is a test', true);

    // Take screenshot with highlight applied atomically
    const cmEditor = mainWindow.locator('.cm-editor').first();
    await takeScreenshot(mainWindow, cmEditor, screenshotDir, step++, 'content-typed');
    writeNarration(
      screenshotDir,
      step++,
      `We've typed some content into the editor.
MkBrowser supports full Markdown syntax, so you can add headings, lists, links, and more.
Now let's save our work.`
    );

    // Demonstrate clicking the Save button
    const saveButton = mainWindow.getByTestId('entry-save-button');
    await takeScreenshot(mainWindow, saveButton, screenshotDir, step++, 'about-to-save');
    writeNarration(
      screenshotDir,
      step++,
      `We'll click the Save button to write our changes to disk.`
    );

    await demonstrateClickForDemo(saveButton);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'file-saved');
    writeNarration(
      screenshotDir,
      step++,
      `The file has been saved and the editor has closed.
Our content is now rendered as formatted Markdown right in the file list.
That's the basic workflow — create, edit, and save files, all from within MkBrowser.`
    );

    // Verify save completed
    await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });

    logScreenshotSummary(screenshotDir);
  });
});
