import * as path from 'path';
import { test as base, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createSeededUserDataDir, removeUserDataDir } from '../helpers/mediaUtils';

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
  // eslint-disable-next-line no-empty-pattern
  testDataPath: async ({}, use) => {
    // Go up to project root, then into test-data
    const testDataPath = path.join(__dirname, '../../../mkbrowser-test');
    await use(testDataPath);
  },

  /**
   * Launch the Electron application and provide it to tests.
   * Automatically closes the app after each test.
   */
  electronApp: async ({ testDataPath }, use) => {
    // Use Electron with the Vite dev build (Playwright's recommended approach)
    const mainJsPath = path.join(__dirname, '../../../.vite/build/main.js');

    // Launch against an isolated, seeded user-data dir (via --user-data-dir) so
    // the app reads/writes a throwaway config.yaml and never touches the user's
    // real ~/.config/mk-browser config. The dir is removed in teardown.
    const userDataDir = createSeededUserDataDir();

    const app = await electron.launch({
      args: [mainJsPath, `--user-data-dir=${userDataDir}`, testDataPath],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SANDBOX: '1',
        DISPLAY: process.env.DISPLAY || ':0',
      },
      // Ensure window is visible (not headless)
      executablePath: undefined,
      timeout: 30000,
    });

    // Provide the app to the test
    await use(app);

    // Cleanup: close the app, then delete the throwaway user-data dir (after
    // close, so the app can't recreate config.yaml on shutdown).
    await app.close();
    removeUserDataDir(userDataDir);
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
