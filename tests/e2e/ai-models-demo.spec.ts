import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demoClick, insertText, logScreenshotSummary, cleanupScreenshots, cleanupTestDataFiles, resetSettings } from './helpers/mediaUtils';

/**
 * E2E Demo Test — Configuring AI Models
 *
 * MkBrowser ships with no built-in AI models, so before any AI feature works the
 * user defines at least one. This demo:
 *   1. Opens AI Settings from the System Menu and shows the "no models" notice.
 *   2. Clicks "Configure Models" to open the AI Models tab (its only entry point).
 *   3. Adds a model for a local llama.cpp server: name, OpenAI-compatible
 *      provider, model ID, localhost Base URL, and zero prices — then Saves.
 *   4. Shows the model marked Active, and back on AI Settings, selected in the
 *      AI Model dropdown.
 *
 * Nothing is sent to a model, so no AI server needs to be running. The seed
 * config defines no models, and the model lives only in the test's throwaway
 * user-data dir.
 */

const MODEL_NAME = 'Local Llama';

test.describe('AI Models Demo', () => {
  test('define the first AI model', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow, { aiEnabled: true });

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
In this demo we'll set up an AI model.
MK Browser doesn't come with any AI models built in, so before you can use any AI feature you define at least one model yourself.
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

    // ── 4. No models yet ──────────────────────────────────────────────
    const noModelsNotice = mainWindow.getByTestId('ai-no-models-notice');
    await expect(noModelsNotice).toBeVisible({ timeout: 5000 });
    const configureButton = mainWindow.getByTestId('ai-settings-configure-models-button');
    await takeScreenshot(mainWindow, configureButton, screenshotDir, step++, 'highlight-configure-models');
    writeNarration(
      screenshotDir,
      step++,
      `In the AI Model section we're told that no AI models are defined yet.
We will click "Configure Models" to open the AI Models tab, where models are defined.`
    );

    await demoClick(configureButton);

    // ── 5. The (empty) AI Models tab ──────────────────────────────────
    const modelsView = mainWindow.getByTestId('view-ai-models');
    await expect(modelsView).toHaveAttribute('data-active-view', 'true', { timeout: 5000 });
    await expect(mainWindow.getByTestId('tab-button-ai-models')).toBeVisible();
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'ai-models-open');
    writeNarration(
      screenshotDir,
      step++,
      `The AI Models tab opens.
On the left is the list of models, by the names we give them, and on the right are the details of the selected model.
The list starts out empty.`
    );

    // ── 6. Add a model and name it ────────────────────────────────────
    const addButton = mainWindow.getByTestId('ai-models-add-button');
    await takeScreenshot(mainWindow, addButton, screenshotDir, step++, 'highlight-add-model');
    writeNarration(
      screenshotDir,
      step++,
      `We will click the plus button to add a model.`
    );

    await demoClick(addButton);

    const renameInput = mainWindow.getByTestId('ai-models-rename-input');
    await expect(renameInput).toBeVisible({ timeout: 5000 });
    await insertText(mainWindow, MODEL_NAME, true, renameInput);
    await takeScreenshot(mainWindow, renameInput, screenshotDir, step++, 'model-name-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We have named the model "${MODEL_NAME}". This is just a friendly name for us to pick it by.`
    );

    await renameInput.press('Enter');
    await expect(modelsView.locator('[data-testid^="ai-models-select-button-"]', { hasText: MODEL_NAME })).toBeVisible({ timeout: 5000 });

    // ── 7. Provider ───────────────────────────────────────────────────
    const providerSelect = mainWindow.getByTestId('ai-models-provider-select');
    await providerSelect.selectOption('OPENAI');
    await expect(providerSelect).toHaveValue('OPENAI');
    await takeScreenshot(mainWindow, providerSelect, screenshotDir, step++, 'provider-selected');
    writeNarration(
      screenshotDir,
      step++,
      `For the provider we choose "OpenAI / OpenAI-compatible".
Local model servers like llama.cpp and LM Studio speak the same protocol as OpenAI, so they use this provider too.`
    );

    // ── 8. Model ID ───────────────────────────────────────────────────
    const modelInput = mainWindow.getByTestId('ai-models-model-input');
    await insertText(mainWindow, 'local', true, modelInput);
    await takeScreenshot(mainWindow, modelInput, screenshotDir, step++, 'model-id-entered');
    writeNarration(
      screenshotDir,
      step++,
      `The Model ID is the model name the server expects.
A llama.cpp server runs just one model, so any name works here; we use "local".`
    );

    // ── 9. Base URL ───────────────────────────────────────────────────
    const baseUrlInput = mainWindow.getByTestId('ai-models-base-url-input');
    await insertText(mainWindow, 'http://localhost:8080/v1', true, baseUrlInput);
    await takeScreenshot(mainWindow, baseUrlInput, screenshotDir, step++, 'base-url-entered');
    writeNarration(
      screenshotDir,
      step++,
      `The Base URL is where the model's API lives. For a cloud provider you can leave it blank to use the provider's standard address.
Our llama.cpp server is running on this computer, so we enter its local address.`
    );

    // ── 10. Prices ────────────────────────────────────────────────────
    const inputPrice = mainWindow.getByTestId('ai-models-input-price-input');
    const outputPrice = mainWindow.getByTestId('ai-models-output-price-input');
    await insertText(mainWindow, '0', false, inputPrice);
    await insertText(mainWindow, '0', false, outputPrice);
    await takeScreenshot(mainWindow, outputPrice, screenshotDir, step++, 'prices-entered');
    writeNarration(
      screenshotDir,
      step++,
      `The two prices are the cost per million input and output tokens, which MK Browser uses to estimate your spending.
A local model is free, so both are zero.`
    );

    // ── 11. Save ──────────────────────────────────────────────────────
    const saveButton = mainWindow.getByTestId('ai-models-save-button');
    await expect(saveButton).toBeEnabled();
    await takeScreenshot(mainWindow, saveButton, screenshotDir, step++, 'highlight-save');
    writeNarration(
      screenshotDir,
      step++,
      `We will click "Save" to store the model.`
    );

    await demoClick(saveButton);

    await expect(mainWindow.getByTestId('ai-models-error')).toHaveCount(0);
    await expect(mainWindow.getByTestId('ai-models-dirty')).toHaveCount(0);
    const activeBadge = mainWindow.getByTestId('ai-models-active-badge');
    await expect(activeBadge).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, activeBadge, screenshotDir, step++, 'model-active');
    writeNarration(
      screenshotDir,
      step++,
      `The model is saved. Since it's our first model, it automatically became the active one, as the "Active" label shows.`
    );

    // ── 12. Back on AI Settings, the model is selected ────────────────
    await demoClick(mainWindow.getByTestId('tab-button-ai-settings'));
    const modelSelect = mainWindow.getByTestId('ai-model-select');
    await expect(modelSelect).toBeVisible({ timeout: 5000 });
    await expect(modelSelect).toHaveValue(MODEL_NAME);
    await takeScreenshot(mainWindow, modelSelect, screenshotDir, step++, 'ai-settings-model-selected');
    writeNarration(
      screenshotDir,
      step++,
      `Back on the AI Settings tab, the AI Model dropdown now shows "${MODEL_NAME}".
When you've defined several models, this dropdown is where you choose which one MK Browser uses.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
