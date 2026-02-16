import { test, expect } from './fixtures/electronApp';
import * as path from 'path';

/**
 * E2E Test: Open Folder
 * 
 * This test verifies that MkBrowser can launch with a folder
 * specified via command-line argument and display its contents.
 */
test.describe('Open Folder', () => {
  test('should launch with folder and display files', async ({ mainWindow }) => {
    // Wait for content to load
    await mainWindow.waitForTimeout(2000);
    
    // Verify files are visible
    await expect(mainWindow.getByText('sample.md')).toBeVisible({ timeout: 10000 });
    await expect(mainWindow.getByText('readme.txt')).toBeVisible();
    await expect(mainWindow.getByText('notes.md')).toBeVisible();
  });
});
