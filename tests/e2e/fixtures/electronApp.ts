import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import * as path from 'path';

/**
 * Custom Playwright fixtures for Electron testing.
 * Provides automatic setup and teardown of the Electron app.
 */
export const test = base.extend<{
  electronApp: ElectronApplication;
  mainWindow: Page;
  testDataPath: string;
}>({
  /**
   * Provide the test data folder path for use in tests.
   */
  testDataPath: async ({}, use) => {
    // Go up to project root, then into test-data
    const testDataPath = path.join(__dirname, '../../../test-data/mkbrowser-test');
    await use(testDataPath);
  },

  /**
   * Launch the Electron application and provide it to tests.
   * Automatically closes the app after each test.
   */
  electronApp: async ({ testDataPath }, use) => {
    // Use Electron with the Vite dev build (Playwright's recommended approach)
    const mainJsPath = path.join(__dirname, '../../../.vite/build/main.js');
    
    const app = await electron.launch({
      args: [mainJsPath, testDataPath],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SANDBOX: '1',
      },
    });
    
    // Provide the app to the test
    await use(app);
    
    // Cleanup: close the app after the test
    await app.close();
  },

  /**
   * Get the first (main) window of the Electron app.
   * Waits for the window to be ready before providing it.
   */
  mainWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

// Re-export expect from Playwright
export { expect } from '@playwright/test';
