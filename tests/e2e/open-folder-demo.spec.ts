import { test, expect } from './fixtures/electronApp';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E Demo Test: Creates screenshots for user guide video
 * Run with: npm run test:e2e -- open-folder-demo.spec.ts
 * Then convert to video with: ./create-video-from-screenshots.sh
 */
test.describe('User Guide Demo', () => {
  test('complete workflow with screenshots', async ({ mainWindow }) => {
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

    // Verify and capture files list
    await expect(mainWindow.getByText('sample.md')).toBeVisible({ timeout: 10000 });
    await expect(mainWindow.getByText('readme.txt')).toBeVisible();
    await expect(mainWindow.getByText('notes.md')).toBeVisible();
    await screenshot('02-files-visible');

    // Click create file button
    await mainWindow.getByTestId('create-file-button').click();
    await mainWindow.waitForTimeout(500);
    await screenshot('03-create-dialog-open');

    // Create the file
    await mainWindow.getByTestId('create-file-dialog-create-button').click();
    await mainWindow.waitForTimeout(1000);
    await screenshot('04-new-file-created');

    // Type content
    await mainWindow.keyboard.type('this is a test');
    await mainWindow.waitForTimeout(500);
    await screenshot('05-content-typed');

    // Save the file
    await mainWindow.getByTestId('entry-save-button').click();
    await mainWindow.waitForTimeout(1000);
    await screenshot('06-file-saved');

    // Verify save completed
    await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });
    await screenshot('07-final-state');

    console.log(`\n✓ Created ${step - 1} screenshots in ${screenshotDir}`);
    console.log('Run ./create-video-from-screenshots.sh to create video');
  });
});
