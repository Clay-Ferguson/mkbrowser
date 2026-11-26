import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demoClick, insertText, logScreenshotSummary, cleanupScreenshots, cleanupTestDataFiles, resetSettings } from './helpers/mediaUtils';

/**
 * E2E Demo Test — Configuring AI Personas
 *
 * A persona is a named block of instructions that MkBrowser adds to the AI's
 * system prompt for AI Chat and AI Rewrite. This demo:
 *   1. Opens AI Settings from the System Menu.
 *   2. Clicks "Configure Personas" to open the AI Personas tab (its only entry
 *      point), which lists the seeded Hemingway and Pirate personas.
 *   3. Adds a "Concise" persona, writes its instructions, and Saves.
 *   4. Back on AI Settings, opens the persona dropdown and shows "Concise" there.
 *
 * Nothing is sent to a model. The personas live only in the test's throwaway
 * user-data dir (seeded from fixtures/seed-config.yaml).
 */

const PERSONA_NAME = 'Concise';
const PERSONA_INSTRUCTIONS =
  'Answer as briefly as possible. Use plain words, short sentences, and bullet points instead of paragraphs. Never pad an answer.';

test.describe('AI Personas Demo', () => {
  test('define a new AI persona', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow, { aiEnabled: true, seedModel: true });

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
      `Welcome to this MK Browser feature demo.
In this demo we'll create an AI Persona.
A persona is a set of instructions, with a name, that tells the AI how to behave in AI Chat and when it rewrites your text.
We will start by opening the System Menu to get to the AI Settings view.`
    );

    // ── 2. Open the System popup menu ─────────────────────────────────
    const systemMenuButton = mainWindow.getByTestId('system-menu-button');
    await expect(systemMenuButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, systemMenuButton, screenshotDir, step++, 'highlight-system-menu');
    writeNarration(
      screenshotDir,
      step++,
      `Here in the top right corner is the System Menu button.`
    );

    await demoClick(systemMenuButton);

    // ── 3. Click the "AI Settings" menu item ──────────────────────────
    const aiSettingsItem = mainWindow.getByTestId('menu-ai-settings');
    await expect(aiSettingsItem).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, aiSettingsItem, screenshotDir, step++, 'highlight-ai-settings');
    writeNarration(
      screenshotDir,
      step++,
      `We will click "AI Settings" to open the AI Settings view.`
    );

    await demoClick(aiSettingsItem);

    // ── 4. The AI Persona section ─────────────────────────────────────
    const configureButton = mainWindow.getByTestId('ai-settings-configure-personas-button');
    await expect(configureButton).toBeVisible({ timeout: 5000 });
    await configureButton.scrollIntoViewIfNeeded();
    await takeScreenshot(mainWindow, configureButton, screenshotDir, step++, 'highlight-configure-personas');
    writeNarration(
      screenshotDir,
      step++,
      `In the AI Persona section, the dropdown picks which persona is active.
To create or change personas, we click "Configure Personas".`
    );

    await demoClick(configureButton);

    // ── 5. The AI Personas tab ────────────────────────────────────────
    const personasView = mainWindow.getByTestId('view-ai-personas');
    await expect(personasView).toHaveAttribute('data-active-view', 'true', { timeout: 5000 });
    await expect(mainWindow.getByTestId('tab-button-ai-personas')).toBeVisible();
    const personaRows = personasView.locator('[data-testid^="ai-personas-select-button-"]');
    await expect(personaRows.filter({ hasText: 'Hemingway' })).toBeVisible({ timeout: 5000 });
    await expect(personaRows.filter({ hasText: 'Pirate' })).toBeVisible();
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'ai-personas-open');
    writeNarration(
      screenshotDir,
      step++,
      `The AI Personas tab opens.
On the left are the personas we've already defined, and on the right are the instructions of the selected one.`
    );

    // ── 6. Add a persona and name it ──────────────────────────────────
    const addButton = mainWindow.getByTestId('ai-personas-add-button');
    await takeScreenshot(mainWindow, addButton, screenshotDir, step++, 'highlight-add-persona');
    writeNarration(
      screenshotDir,
      step++,
      `We will click the plus button to add a new persona.`
    );

    await demoClick(addButton);

    const renameInput = mainWindow.getByTestId('ai-personas-rename-input');
    await expect(renameInput).toBeVisible({ timeout: 5000 });
    await insertText(mainWindow, PERSONA_NAME, true, renameInput);
    await takeScreenshot(mainWindow, renameInput, screenshotDir, step++, 'persona-name-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We have named the persona "${PERSONA_NAME}".`
    );

    await renameInput.press('Enter');
    await expect(personaRows.filter({ hasText: PERSONA_NAME })).toBeVisible({ timeout: 5000 });

    // ── 7. Write the instructions ─────────────────────────────────────
    const promptTextarea = mainWindow.getByTestId('ai-personas-prompt-textarea');
    await insertText(mainWindow, PERSONA_INSTRUCTIONS, true, promptTextarea);
    await expect(promptTextarea).toHaveValue(PERSONA_INSTRUCTIONS);
    await takeScreenshot(mainWindow, promptTextarea, screenshotDir, step++, 'instructions-entered');
    writeNarration(
      screenshotDir,
      step++,
      `In the Persona Instructions box we describe how the AI should behave.
This persona tells it to keep its answers as short and plain as possible.`
    );

    // ── 8. Save ───────────────────────────────────────────────────────
    const saveButton = mainWindow.getByTestId('ai-personas-save-button');
    await expect(saveButton).toBeEnabled();
    await takeScreenshot(mainWindow, saveButton, screenshotDir, step++, 'highlight-save');
    writeNarration(
      screenshotDir,
      step++,
      `We will click "Save" to store the persona.`
    );

    await demoClick(saveButton);

    await expect(mainWindow.getByTestId('ai-personas-error')).toHaveCount(0);
    await expect(mainWindow.getByTestId('ai-personas-dirty')).toHaveCount(0);

    // ── 9. Back on AI Settings, the persona is in the dropdown ────────
    await demoClick(mainWindow.getByTestId('tab-button-ai-settings'));
    const personaCombobox = mainWindow.getByTestId('ai-persona-combobox');
    await expect(personaCombobox).toBeVisible({ timeout: 5000 });
    await personaCombobox.scrollIntoViewIfNeeded();
    await demoClick(personaCombobox);

    const conciseOption = mainWindow.getByRole('option', { name: PERSONA_NAME, exact: true });
    await expect(conciseOption).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, conciseOption, screenshotDir, step++, 'persona-in-dropdown');
    writeNarration(
      screenshotDir,
      step++,
      `Back on the AI Settings tab, our new "${PERSONA_NAME}" persona is now one of the choices in the persona dropdown.`
    );

    await demoClick(conciseOption);
    await expect(personaCombobox).toHaveValue(PERSONA_NAME);
    await takeScreenshot(mainWindow, personaCombobox, screenshotDir, step++, 'persona-selected');
    writeNarration(
      screenshotDir,
      step++,
      `We've selected it, so from now on AI Chat and AI Rewrite will answer concisely.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
