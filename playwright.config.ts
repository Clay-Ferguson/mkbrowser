import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for Electron E2E testing.
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  
  // Maximum time one test can run
  timeout: 120000, // 2 minutes for E2E tests,
  
  // Run tests serially (Electron instances can conflict if parallel)
  workers: 1,
  
  // Retry on CI failures only
  retries: process.env.CI ? 2 : 0,
  
  // Reporter to use
  reporter: 'html',
  
  use: {
    // Capture trace on first retry
    trace: 'on-first-retry',
    
    // Take screenshot on failure
    screenshot: 'only-on-failure',
    
    // Collect video on failure
    video: 'retain-on-failure',
  },

  // Build the Electron app before running tests
  globalSetup: './tests/e2e/global-setup.ts',
});
