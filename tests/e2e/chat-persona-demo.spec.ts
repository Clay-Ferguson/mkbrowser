import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demoClick, insertText, logScreenshotSummary, cleanupScreenshots, cleanupTestDataFiles } from './helpers/mediaUtils';

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

    // Delete any leftover HUMAN.md in the folder we start out in (mkbrowser-test).
    // If it already exists, starting a new chat warns that the file is present,
    // which would interrupt the demo. Removing it ensures a clean run every time.
    const testDataDir = path.resolve(path.join(__dirname, '../../mkbrowser-test'));
    fs.rmSync(path.join(testDataDir, 'HUMAN.md'), { force: true });

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

    // ── 9. The chat editor opens — get ready to type the first prompt ──
    const cmEditor = mainWindow.locator('.cm-editor').first();
    await expect(cmEditor).toBeVisible({ timeout: 10000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'chat-editor-open');
    writeNarration(
      screenshotDir,
      step++,
      `A new chat has started, and here in the Chat tab we have an editor ready for our message.
      Let's enter a prompt to begin a conversation with our pirate friend.`
    );

    const firstPrompt = 'what do you usually do on a warm summer night?';
    await insertText(mainWindow, firstPrompt, true);

    await takeScreenshot(mainWindow, cmEditor, screenshotDir, step++, 'first-prompt-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We've typed our question: "what do you usually do on a warm summer night?".
      Now we'll click the "Ask AI" button, which appears here because this file is named HUMAN.md,
      marking it as a message from us to the AI.`
    );

    // ── 10. Queue the scripted pirate answer, then click "Ask AI" ─────
    const pirateAnswer1 = `# Ahoy there, Matey! 🏴‍☠️

Shiver me timbers, ye be askin' a pirate about the fine rituals of a warm summer night? Pull up a barrel and lend an ear, for the stars be bright and the sea be calm!

When the sun dips below the horizon and the moon rises like a silver doubloon over the waves, a pirate's work never truly ends, but the rhythm changes. Here be what a salty dog like meself usually gets up to:

### 🌙 A Pirate's Summer Night Rituals

| Activity | Description |
| :--- | :--- |
| **Stargazin'** | Navigatin' the dark waters by lookin' at the constellations. The North Star be our truest guide! |
| **Sea Shanties** | Singin' loud and proud with the crew to keep the spirits high and the rum flowin'. |
| **Watchin' the Horizon** | Keepin' a weather eye open for any merchant ships`;

    await mainWindow.evaluate(
      (answer) => (window as any).electronAPI.queueScriptedAnswer(answer),
      pirateAnswer1
    );

    const askAiButton = mainWindow.getByTestId('ask-ai-button').last();
    await takeScreenshot(mainWindow, askAiButton, screenshotDir, step++, 'highlight-ask-ai');
    writeNarration(
      screenshotDir,
      step++,
      `Let's click "Ask AI" to send our question off to the Pirate.`
    );

    await demoClick(askAiButton);

    // ── 11. Wait for the pirate's first response to appear ────────────
    await expect(mainWindow.getByText('Shiver me timbers').first()).toBeVisible({ timeout: 30000 });
    await mainWindow.waitForTimeout(1000);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'first-pirate-response');
    writeNarration(
      screenshotDir,
      step++,
      `And there's our answer — written entirely in pirate-speak, just as the persona promised.
      The Pirate tells us about stargazin', sea shanties, and keepin' a weather eye on the horizon.
      We've learned a little something about pirate nightlife.
      Let's ask one more question.`
    );

    // ── 12. Click the "Reply" button to continue the conversation ─────
    const replyButton = mainWindow.getByTestId('ai-reply-button');
    await expect(replyButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, replyButton, screenshotDir, step++, 'highlight-reply');
    writeNarration(
      screenshotDir,
      step++,
      `Above the Pirate's answer there's a "Reply" button.
      Let's click it to ask a follow-up question.`
    );

    await demoClick(replyButton);
    await mainWindow.waitForTimeout(2000);

    // ── 13. Type the follow-up question ───────────────────────────────
    const replyEditor = mainWindow.locator('.cm-editor').first();
    await expect(replyEditor).toBeVisible({ timeout: 10000 });

    const secondPrompt =
      "Ahoy! I've heard there's a newfangled device sailors put on their ships nowadays to navigate by the stars without all the squintin'. Have ye come across it? And what be the trusty device ye use yourself these days?";
    await insertText(mainWindow, secondPrompt, true);

    await takeScreenshot(mainWindow, replyEditor, screenshotDir, step++, 'second-prompt-entered');
    writeNarration(
      screenshotDir,
      step++,
      `This time we'll get a bit cheeky and ask the Pirate whether he's heard of the modern gadgets
      folks use to navigate by the stars, and what device he himself relies on.`
    );

    // ── 14. Queue the second scripted answer, then click "Ask AI" ─────
    const pirateAnswer2 = `# Arr, a Fine Question, Ye Curious Soul! ⚓

Aye, I've caught wind o' these modern marvels — them "GPS" boxes that whisper yer position straight from the heavens! Magic in a tin, I tell ye, no readin' o' the stars required. But trust a contraption that begs for batteries? Bah, I'll have none of it!

### 🧭 What This Old Salt Still Swears By

| Tool | Why I Trust It |
| :--- | :--- |
| **The Sextant** | Me trusty brass companion! It measures the angle 'twixt a star and the horizon, and never once has it run dry of power. |
| **The Compass** | Points me north through fog, storm, and rum-soaked nights alike. |
| **Me Own Two Eyes** | The stars have guided sailors since afore yer grandpappy's grandpappy — they'll not fail me now! |

So keep yer glowin' boxes, matey. I'll take me sextant and a sky full o' stars any night o' the week!`;

    await mainWindow.evaluate(
      (answer) => (window as any).electronAPI.queueScriptedAnswer(answer),
      pirateAnswer2
    );

    const askAiButton2 = mainWindow.getByTestId('ask-ai-button').last();
    await takeScreenshot(mainWindow, askAiButton2, screenshotDir, step++, 'highlight-ask-ai-2');
    writeNarration(
      screenshotDir,
      step++,
      `We'll click "Ask AI" once more to hear what our seafaring friend has to say.`
    );

    await demoClick(askAiButton2);

    // ── 15. Wait for the second response, scroll it into view ─────────
    await expect(mainWindow.getByText('Magic in a tin').first()).toBeVisible({ timeout: 30000 });
    await mainWindow.waitForTimeout(1000);

    // The answer is long, so scroll the chat container to the bottom to be
    // sure the Pirate's full reply is visible on screen.
    await mainWindow.evaluate(() => {
      const scrollers = Array.from(document.querySelectorAll('main, [class*="overflow-y-auto"]'));
      const scroller = scrollers.find((el) => el.scrollHeight > el.clientHeight);
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    await mainWindow.waitForTimeout(1000);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'second-pirate-response');
    writeNarration(
      screenshotDir,
      step++,
      `Wonderful — the Pirate knows all about GPS, but he calls it "magic in a tin" and won't trust a gadget that begs for batteries.
      He'll stick with his trusty sextant, his compass, and his own two eyes.
      And that's how easy it is to give your AI agent a personality of its very own and have a little fun chatting with it.
      Thanks for watching, and happy swashbucklin'!`
    );

    logScreenshotSummary(screenshotDir);
  });
});
