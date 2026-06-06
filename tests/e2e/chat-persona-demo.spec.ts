import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demoClick, logScreenshotSummary, cleanupScreenshots, cleanupTestDataFiles } from './helpers/mediaUtils';

/**
 * E2E Demo Test — AI Chat with a Custom Persona
 *
 * Demonstrates how a user can give their AI agent a custom personality (a
 * "Persona") and then chat with that agent. This file is built up across
 * several phases; Phase 1 covers selecting a "Pirate" persona in AI Settings
 * and then starting a new AI chat from the Tools menu.
 *
 * NOTE: This is a work-in-progress demo. Narrations are written assuming more
 * of the demo follows — they should not sound like an ending.
 */
test.describe('AI Chat Persona Demo', () => {
  test('define an AI persona and start a chat with it', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // ── 1. Initial state ──────────────────────────────────────────────
    const mainContent = mainWindow.getByTestId('browser-main-content');
    await expect(mainContent.getByText('sample.md').first()).toBeVisible({ timeout: 10000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome back to MkBrowser.
      In this demo we're going to look at how you can give your AI agent a custom personality, which we call a Persona,
      and then have a conversation with it.
      To get started, we'll open the System menu so we can reach the AI Settings.`
    );

    // ── 2. Open the System popup menu ─────────────────────────────────
    const systemMenuButton = mainWindow.getByTestId('system-menu-button');
    await expect(systemMenuButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, systemMenuButton, screenshotDir, step++, 'highlight-system-menu');
    writeNarration(
      screenshotDir,
      step++,
      `Here in the top right corner is the System menu button.
      Let's click it to open the System popup menu.`
    );

    await demoClick(systemMenuButton);

    // ── 3. Click the "AI Settings" menu item ──────────────────────────
    const aiSettingsItem = mainWindow.getByTestId('menu-ai-settings');
    await expect(aiSettingsItem).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, aiSettingsItem, screenshotDir, step++, 'highlight-ai-settings');
    writeNarration(
      screenshotDir,
      step++,
      `The System menu is open.
      We can see an "AI Settings" option.
      Let's click it to open the AI Settings view.`
    );

    await demoClick(aiSettingsItem);

    // ── 4. Locate the persona combobox and scroll it into view ────────
    await mainWindow.waitForTimeout(500);
    const personaCombobox = mainWindow.getByTestId('ai-persona-combobox');
    await expect(personaCombobox).toBeVisible({ timeout: 5000 });
    await personaCombobox.scrollIntoViewIfNeeded();
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, personaCombobox, screenshotDir, step++, 'highlight-persona-combobox');
    writeNarration(
      screenshotDir,
      step++,
      `We're now in the AI Settings view.
      Down here in the AI Personas section is a dropdown where we can pick which persona our agent should use.
      Let's open it and choose the "Pirate" persona.`
    );

    // ── 5. Open the dropdown and select the "Pirate" persona ──────────
    await demoClick(personaCombobox);

    const pirateOption = mainWindow.getByRole('option', { name: 'Pirate', exact: true });
    await expect(pirateOption).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, pirateOption, screenshotDir, step++, 'highlight-pirate-option');
    writeNarration(
      screenshotDir,
      step++,
      `The dropdown is open, showing the personas we've defined.
      Let's select the "Pirate" persona.`
    );

    await demoClick(pirateOption);
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, personaCombobox, screenshotDir, step++, 'pirate-selected');
    writeNarration(
      screenshotDir,
      step++,
      `We've selected the Pirate persona.
      This persona tells the AI to behave like a pirate and to write like a pirate,
      so every answer it gives will be full of swashbuckling pirate talk.
      Now let's head back to the Browse view to start chatting.`
    );

    // ── 6. Switch back to the Browse view ─────────────────────────────
    const tabBar = mainWindow.getByTestId('app-tab-buttons');
    const browseTab = tabBar.getByTestId('tab-button-browser');
    await expect(browseTab).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, browseTab, screenshotDir, step++, 'highlight-browse-tab');
    writeNarration(
      screenshotDir,
      step++,
      `Up here in the tab bar, we'll click the "Browse" button to switch back to the Browse view.`
    );

    await demoClick(browseTab);
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'back-in-browse-view');
    writeNarration(
      screenshotDir,
      step++,
      `We're back in the Browse view.
      Now let's start a brand new chat conversation with our Pirate agent.`
    );

    // ── 7. Open the Tools menu ────────────────────────────────────────
    const toolsMenuButton = mainWindow.getByTestId('tools-menu-button');
    await expect(toolsMenuButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, toolsMenuButton, screenshotDir, step++, 'highlight-tools-menu');
    writeNarration(
      screenshotDir,
      step++,
      `Starting a new chat lives under the Tools menu.
      Let's click the Tools menu button to open it.`
    );

    await demoClick(toolsMenuButton);

    // ── 8. Click "New AI Chat" ────────────────────────────────────────
    const newAiChatItem = mainWindow.getByTestId('menu-new-ai-chat');
    await expect(newAiChatItem).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, newAiChatItem, screenshotDir, step++, 'highlight-new-ai-chat');
    writeNarration(
      screenshotDir,
      step++,
      `The Tools menu is now open.
      We can see a "New AI Chat" option.
      Let's click it to begin a fresh conversation with our Pirate persona.`
    );

    await demoClick(newAiChatItem);
    await mainWindow.waitForTimeout(2000);

    logScreenshotSummary(screenshotDir);
  });
});
