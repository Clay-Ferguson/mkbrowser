import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demonstrateClickForDemo, insertTextForDemo, logScreenshotSummary, cleanupScreenshots, cleanupTestDataFiles } from './helpers/mediaUtils';

/**
 * E2E Demo Test - LaTeX Rendering
 * 
 * This test demonstrates MkBrowser's automatic LaTeX rendering capability.
 * Creates a file with mathematical formulas and shows how they're rendered
 * automatically when the file is saved.
 */
test.describe('Create LaTeX Demo', () => {
  test('demonstrate LaTeX formula rendering', async ({ mainWindow }) => {
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
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome back to MkBrowser.
In this demo, we'll explore one of MkBrowser's powerful features: automatic [LaTeX](/lˈeɪtɛk/) rendering for mathematical formulas.
Let's create a file with a mathematical equation.`
    );

    // Click the create file button
    const createButton = mainWindow.getByTestId('create-file-button');
    await takeScreenshot(mainWindow, createButton, screenshotDir, step++, 'about-to-click-create');
    writeNarration(screenshotDir, step++, `We'll start by creating a new file.`);

    await demonstrateClickForDemo(createButton);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'create-dialog-open');
    writeNarration(
      screenshotDir,
      step++,
      `The Create File dialog opens.
Let's give our file a name that reflects its mathematical content.`
    );

    // Type the filename
    const filenameInput = mainWindow.getByTestId('create-file-dialog-input');
    await insertTextForDemo(mainWindow, 'my-latex-formula', true, filenameInput);

    await takeScreenshot(mainWindow, filenameInput, screenshotDir, step++, 'filename-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We've named it "my-latex-formula".
Now let's create the file and add some mathematical content.`
    );

    // Click Create button in dialog
    const createDialogButton = mainWindow.getByTestId('create-file-dialog-create-button');
    await takeScreenshot(mainWindow, createDialogButton, screenshotDir, step++, 'about-to-create-file');
    writeNarration(screenshotDir, step++, `Clicking Create to open our new file.`);

    await demonstrateClickForDemo(createDialogButton);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'new-file-created');
    writeNarration(
      screenshotDir,
      step++,
      `Great! Our file is created and the editor is ready.
Now let's add some [LaTeX](/lˈeɪtɛk/) content.
We'll start with a brief explanation, then include the quadratic formula.`
    );

    // Type the LaTeX content with explanation
    const latexContent = `The quadratic formula solves equations of the form ax² + bx + c = 0. It provides the solutions for x:

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$`;

    await insertTextForDemo(mainWindow, latexContent, true);

    // Take screenshot with the content typed
    const cmEditor = mainWindow.locator('.cm-editor').first();
    await takeScreenshot(mainWindow, cmEditor, screenshotDir, step++, 'latex-typed');
    writeNarration(
      screenshotDir,
      step++,
      `We've entered our explanation and the quadratic formula.
Notice the [LaTeX](/lˈeɪtɛk/) code is surrounded by double dollar signs — this tells MkBrowser to render it as a mathematical formula.
The formula itself uses [LaTeX](/lˈeɪtɛk/) syntax with commands like "frac" for fractions and "sqrt" for square roots.
Now watch what happens when we save.`
    );

    // Click Save button
    const saveButton = mainWindow.getByTestId('entry-save-button');
    await takeScreenshot(mainWindow, saveButton, screenshotDir, step++, 'about-to-save');
    writeNarration(
      screenshotDir,
      step++,
      `Let's save the file and see the LaTeX magic happen.`
    );

    await demonstrateClickForDemo(saveButton);

    // Wait a moment for the rendering to complete
    await mainWindow.waitForTimeout(1000);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'formula-rendered');
    writeNarration(
      screenshotDir,
      step++,
      `Amazing! The [LaTeX](/lˈeɪtɛk/) code has been automatically rendered into a beautiful, properly formatted mathematical formula.
The quadratic formula is now displayed with professional typography — fractions, square roots, and all mathematical symbols are perfectly rendered.
This makes MkBrowser ideal for taking notes on mathematics, physics, or any technical subject.
No special tools needed — just write your [LaTeX](/lˈeɪtɛk/) between dollar sign delimiters and MkBrowser handles the rest.`
    );

    // Verify save completed
    await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });

    logScreenshotSummary(screenshotDir);
  });
});
