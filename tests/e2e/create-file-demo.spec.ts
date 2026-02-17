import { test, expect } from './fixtures/electronApp';
import { demonstrateTyping, highlightElement, screenshotWithHighlight } from './helpers/visual-indicators';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E Demo Test with Visual Indicators
 * Creates screenshots with visual cues showing where clicks and typing occur.
 *
 * Run with: npm run test:e2e -- create-file-demo.spec.ts
 * Then convert to video with: ./create-video-from-screenshots.sh create-file-demo
 */
test.describe('Create File Demo', () => {
  test('complete workflow with visual indicators', async ({ mainWindow }) => {
    // Control whether screenshots are captured
    const SCREENSHOTS = true;

    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    // Clean and recreate screenshot directory on each run
    if (SCREENSHOTS) {
      fs.rmSync(screenshotDir, { recursive: true, force: true });
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // Clean up any previously created test file to avoid conflicts
    const testFilePath = path.join(__dirname, '../../test-data/mkbrowser-test/my-journal-entry.md');
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }

    let step = 1;
    const screenshot = async (name: string) => {
      if (SCREENSHOTS) {
        await mainWindow.screenshot({
          path: path.join(screenshotDir, `${String(step).padStart(3, '0')}-${name}.png`)
        });
        step++;
      }
    };

    const speak = async (text: string, name = 'narration') => {
      if (SCREENSHOTS) {
        fs.writeFileSync(
          path.join(screenshotDir, `${String(step).padStart(3, '0')}-${name}.txt`),
          text
        );
        step++;
      }
    };

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // Verify files are visible
    await expect(mainWindow.getByText('sample.md')).toBeVisible({ timeout: 10000 });
    await expect(mainWindow.getByText('readme.txt')).toBeVisible();
    await expect(mainWindow.getByText('notes.md')).toBeVisible();
    await screenshot('files-visible');
    await speak('Welcome to MkBrowser. Here we can see our files displayed in a browsable list. Markdown files are rendered inline, and we can create, edit, and organize files right from this interface. Let\'s create a new file to see how it works.');

    // Demonstrate clicking the create file button
    const createButton = mainWindow.getByTestId('create-file-button');

    // Highlight and click with proper timing to capture screenshot
    await highlightElement(mainWindow, createButton, 1500);
    await mainWindow.waitForTimeout(200);
    await screenshot('about-to-click-create');
    await speak('We\'ll click the Create File button at the top of the window to add a new file to our folder.');

    await mainWindow.waitForTimeout(300);
    await createButton.click();
    await mainWindow.waitForTimeout(800);

    await screenshot('create-dialog-open');
    await speak('The Create File dialog has appeared. We can enter a custom filename here. Let\'s type a descriptive name for our new file.');

    // Demonstrate typing a filename
    const filenameInput = mainWindow.getByTestId('create-file-dialog-input');
    await demonstrateTyping(mainWindow, 'my-journal-entry', {
      locator: filenameInput,
      showHighlight: true,
      typingDelay: 120,
      pauseAfter: 500,
      highlightDuration: 3000,
    });

    await screenshotWithHighlight(mainWindow, filenameInput,
      path.join(screenshotDir, `${String(step).padStart(3, '0')}-filename-entered.png`));
    step++;
    await speak('We\'ve entered "my-journal-entry" as the filename. Notice we didn\'t include a file extension — MkBrowser will automatically add ".md" to make it a Markdown file.');

    // Demonstrate clicking the Create button in dialog
    const createDialogButton = mainWindow.getByTestId('create-file-dialog-create-button');
    await highlightElement(mainWindow, createDialogButton, 1500);
    await mainWindow.waitForTimeout(200);
    await screenshot('about-to-create-file');
    await speak('Now we\'ll click the Create button to confirm and create the file.');

    await mainWindow.waitForTimeout(300);
    await createDialogButton.click();
    await mainWindow.waitForTimeout(1000);

    await screenshot('new-file-created');
    await speak('Our new file has been created and is now open in edit mode. Notice the text editor that appeared — this is a full-featured code editor where we can write Markdown content.');

    // Demonstrate typing with visual highlight on the focused input area
    await demonstrateTyping(mainWindow, 'this is a test', {
      showHighlight: true,
      typingDelay: 150, // Slower for visual effect
      pauseAfter: 500, // Highlight will still be visible
      highlightDuration: 8000, // Keep highlight visible long enough
    });

    // Take screenshot with highlight applied atomically
    const cmEditor = mainWindow.locator('.cm-editor').first();
    await screenshotWithHighlight(mainWindow, cmEditor,
      path.join(screenshotDir, `${String(step).padStart(3, '0')}-content-typed.png`));
    step++;
    await speak('We\'ve typed some content into the editor. MkBrowser supports full Markdown syntax, so you can add headings, lists, links, and more. Now let\'s save our work.');

    // Demonstrate clicking the Save button
    const saveButton = mainWindow.getByTestId('entry-save-button');
    await highlightElement(mainWindow, saveButton, 1500);
    await mainWindow.waitForTimeout(200);
    await screenshot('about-to-save');
    await speak('We\'ll click the Save button to write our changes to disk.');

    await mainWindow.waitForTimeout(300);
    await saveButton.click();
    await mainWindow.waitForTimeout(1000);

    await screenshot('file-saved');
    await speak('The file has been saved and the editor has closed. Our content is now rendered as formatted Markdown right in the file list. That\'s the basic workflow — create, edit, and save files, all from within MkBrowser.');

    // Verify save completed
    await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });

    if (SCREENSHOTS) {
      const files = fs.readdirSync(screenshotDir);
      const pngCount = files.filter(f => f.endsWith('.png')).length;
      const txtCount = files.filter(f => f.endsWith('.txt')).length;
      console.log(`\n✓ Created ${pngCount} screenshots and ${txtCount} narration files in ${screenshotDir}`);
      console.log('Run ./create-video-from-screenshots.sh create-file-demo to create video');
    } else {
      console.log('\n✓ Test completed (screenshots disabled)');
    }
  });
});
