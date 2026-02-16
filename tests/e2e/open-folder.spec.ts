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

  test('should create a new file, type content, and save', async ({ mainWindow }) => {
    // Wait for content to load
    await mainWindow.waitForTimeout(2000);
    
    // Verify initial files are visible
    await expect(mainWindow.getByText('sample.md')).toBeVisible({ timeout: 10000 });
    
    // Click the create file button
    await mainWindow.getByTestId('create-file-button').click();
    
    // Wait for the create file dialog to appear
    await expect(mainWindow.getByText('Create new file')).toBeVisible({ timeout: 5000 });
    
    // Click the Create button (leaving filename blank for timestamp default)
    await mainWindow.getByTestId('create-file-dialog-create-button').click();
    
    // Wait for the dialog to close and the file to be created
    await mainWindow.waitForTimeout(1000);
    
    // The file should now be in edit mode with CodeMirror editor visible
    // Type content into the editor
    await mainWindow.keyboard.type('this is a test');
    
    // Wait a moment to ensure typing is complete
    await mainWindow.waitForTimeout(500);
    
    // Click the Save button
    await mainWindow.getByTestId('entry-save-button').click();
    
    // Wait for save to complete
    await mainWindow.waitForTimeout(1000);
    
    // Verify the file was saved by checking the Save button is no longer visible
    // (it only appears when in edit mode)
    await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });
  });
});
