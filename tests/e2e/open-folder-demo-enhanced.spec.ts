import { test, expect } from './fixtures/electronApp';
import { demonstrateClick, demonstrateTyping, highlightElement, showCursorAt } from './helpers/visual-indicators';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E Demo Test with Visual Indicators
 * Creates screenshots with visual cues showing where clicks and typing occur.
 *
 * Run with: npm run test:e2e -- open-folder-demo-enhanced.spec.ts
 * Then convert to video with: ./create-video-from-screenshots.sh
 */
test.describe('User Guide Demo (Enhanced)', () => {
  test('complete workflow with visual indicators', async ({ mainWindow }) => {
    const screenshotDir = path.join(__dirname, '../../screenshots');

    // Create screenshot directory
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    let step = 1;
    const screenshot = async (name: string) => {
      await mainWindow.screenshot({
        path: path.join(screenshotDir, `${String(step).padStart(3, '0')}-${name}.png`)
      });
      step++;
    };

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);
    await screenshot('01-initial-view');

    // Verify files are visible
    await expect(mainWindow.getByText('sample.md')).toBeVisible({ timeout: 10000 });
    await expect(mainWindow.getByText('readme.txt')).toBeVisible();
    await expect(mainWindow.getByText('notes.md')).toBeVisible();
    await screenshot('02-files-visible');

    // Demonstrate clicking the create file button
    const createButton = mainWindow.getByTestId('create-file-button');

    // Show cursor pointing at button
    await highlightElement(mainWindow, createButton, 800);
    await showCursorAt(mainWindow, createButton, 600);
    await screenshot('03-about-to-click-create');

    // Perform the click with visual feedback
    await demonstrateClick(mainWindow, createButton, {
      showCursor: false, // Already showed it
      showRipple: true,
      pauseBefore: 200,
      pauseAfter: 800,
    });

    await screenshot('04-create-dialog-open');

    // Demonstrate clicking the Create button in dialog
    const createDialogButton = mainWindow.getByTestId('create-file-dialog-create-button');
    await highlightElement(mainWindow, createDialogButton, 800);
    await showCursorAt(mainWindow, createDialogButton, 600);
    await screenshot('05-about-to-create-file');

    await demonstrateClick(mainWindow, createDialogButton, {
      showCursor: false,
      showRipple: true,
      pauseAfter: 1000,
    });

    await screenshot('06-new-file-created');

    // Demonstrate typing with visual highlight on the focused input area
    await demonstrateTyping(mainWindow, 'this is a test', {
      showHighlight: true,
      typingDelay: 150, // Slower for visual effect
      pauseAfter: 500, // Highlight will still be visible
      highlightDuration: 8000, // Keep highlight visible long enough
    });

    // Take screenshot while highlight is still visible
    await screenshot('07-content-typed');

    // Demonstrate clicking the Save button
    const saveButton = mainWindow.getByTestId('entry-save-button');
    await highlightElement(mainWindow, saveButton, 800);
    await showCursorAt(mainWindow, saveButton, 600);
    await screenshot('08-about-to-save');

    await demonstrateClick(mainWindow, saveButton, {
      showCursor: false,
      showRipple: true,
      pauseAfter: 1000,
    });

    await screenshot('09-file-saved');

    // Verify save completed
    await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });
    await screenshot('10-final-state');

    console.log(`\n✓ Created ${step - 1} screenshots with visual indicators in ${screenshotDir}`);
    console.log('Run ./create-video-from-screenshots.sh to create video');
  });
});
