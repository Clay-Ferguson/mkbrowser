import { test, expect } from './fixtures/electronApp';
import { demonstrateTyping, highlightElement } from './helpers/visual-indicators';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E Demo Test with Visual Indicators
 * Creates screenshots with visual cues showing where clicks and typing occur.
 *
 * Run with: npm run test:e2e -- open-folder-demo-enhanced.spec.ts
 * Then convert to video with: ./create-video-from-screenshots.sh open-folder-demo-enhanced
 */
test.describe('User Guide Demo (Enhanced)', () => {
  test('complete workflow with visual indicators', async ({ mainWindow }) => {
    // Control whether screenshots are captured
    const SCREENSHOTS = true;

    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    // Create screenshot directory if screenshots are enabled
    if (SCREENSHOTS && !fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
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

    // Highlight and click with proper timing to capture screenshot
    await highlightElement(mainWindow, createButton, 1500);
    await mainWindow.waitForTimeout(200);
    await screenshot('03-about-to-click-create');
    
    await mainWindow.waitForTimeout(300);
    await createButton.click();
    await mainWindow.waitForTimeout(800);

    await screenshot('04-create-dialog-open');

    // Demonstrate clicking the Create button in dialog
    const createDialogButton = mainWindow.getByTestId('create-file-dialog-create-button');
    await highlightElement(mainWindow, createDialogButton, 1500);
    await mainWindow.waitForTimeout(200);
    await screenshot('05-about-to-create-file');

    await mainWindow.waitForTimeout(300);
    await createDialogButton.click();
    await mainWindow.waitForTimeout(1000);

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
    await highlightElement(mainWindow, saveButton, 1500);
    await mainWindow.waitForTimeout(200);
    await screenshot('08-about-to-save');

    await mainWindow.waitForTimeout(300);
    await saveButton.click();
    await mainWindow.waitForTimeout(1000);

    await screenshot('09-file-saved');

    // Verify save completed
    await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });
    await screenshot('10-final-state');

    if (SCREENSHOTS) {
      console.log(`\n✓ Created ${step - 1} screenshots with visual indicators in ${screenshotDir}`);
      console.log('Run ./create-video-from-screenshots.sh open-folder-demo-enhanced to create video');
    } else {
      console.log('\n✓ Test completed (screenshots disabled)');
    }
  });
});
