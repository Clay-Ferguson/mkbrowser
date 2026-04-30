import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import { takeStepScreenshot, takeStepScreenshotWithHighlight, writeNarration, demonstrateClickForDemo, insertTextForDemo, logScreenshotSummary, cleanupScreenshots, cleanupTestDataFiles } from './helpers/mediaUtils';

/**
 * E2E Demo Test — AI Chat Feature
 *
 * Walks through a two-turn AI conversation about a trip to Tokyo,
 * using scripted (mocked) AI answers so the demo is deterministic.
 * Captures screenshots and narration at every step for GIF/MP4 assembly.
 */
test.describe('AI Chat Demo', () => {
  test('demonstrate a two-turn AI chat about Tokyo', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();

    // Clean up any previously created AI chat folders (A, A1, A2, …) in mkbrowser-test
    const testDataDir = path.join(__dirname, '../../mkbrowser-test');
    for (const entry of fs.readdirSync(testDataDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^A\d*$/.test(entry.name)) {
        fs.rmSync(path.join(testDataDir, entry.name), { recursive: true, force: true });
      }
    }

    fs.rmSync(path.join(testDataDir, 'HUMAN.md'), { force: true });

    // ── Chat transcript ───────────────────────────────────────────────
    const humanMessage1 =
      "I'm in Tokyo for one more night. It's raining, I'm tired of sushi, and I want to see something 'Cyberpunk.' Where should I go?";

    const aiAnswer1 =
      "Head to Akihabara and duck into an upper-floor retro arcade like 'Hirose Entertainment Yard.' The neon reflections on the wet pavement outside plus the 80s synth sounds inside is peak Cyberpunk—no raw fish required.";

    const humanMessage2 =
      'Perfect. Is there a quiet spot nearby to grab a drink afterward?';

    const aiAnswer2 =
      "Check out 'Bar Sekirei.' It's a hidden gem with a library-like atmosphere. It's the perfect 'calm after the storm' vibe to end your trip.";

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // ── 1. Initial state ──────────────────────────────────────────────
    const mainContent = mainWindow.getByTestId('browser-main-content');
    await expect(mainContent.getByText('sample.md').first()).toBeVisible({ timeout: 10000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. 
      Today we're going to try out the built-in AI Chat feature. 
      This lets you have a back-and-forth conversation with an AI, right inside your file browser.`
    );

    // ── 2. Open Tools menu ────────────────────────────────────────────
    const toolsMenuButton = mainWindow.getByTestId('tools-menu-button');
    await expect(toolsMenuButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, toolsMenuButton, screenshotDir, step++, 'highlight-tools-menu');
    writeNarration(
      screenshotDir,
      step++,
      `First, we'll open the Tools menu at the top of the window.`
    );

    await demonstrateClickForDemo(toolsMenuButton);

    // ── 3. Click "New AI Chat" ────────────────────────────────────────
    const newAiChatItem = mainWindow.getByTestId('menu-new-ai-chat');
    await expect(newAiChatItem).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, newAiChatItem, screenshotDir, step++, 'highlight-new-ai-chat');
    writeNarration(
      screenshotDir,
      step++,
      `The Tools menu is open. 
      We can see a "New AI Chat" option. 
      Let's click it to start a conversation.`
    );

    await demonstrateClickForDemo(newAiChatItem);

    // Wait for the AI chat folder to be created and the editor to open
    await mainWindow.waitForTimeout(2000);

    // ── 4. HUMAN.md is open in edit mode — type the first question ───
    const cmEditor = mainWindow.locator('.cm-editor').first();
    await expect(cmEditor).toBeVisible({ timeout: 10000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'editor-open');
    writeNarration(
      screenshotDir,
      step++,
      `A new AI chat folder has been created, and the editor is open and ready for our question. 
      Let's ask a question.`
    );

    await insertTextForDemo(mainWindow, humanMessage1, true);

    await takeStepScreenshotWithHighlight(mainWindow, cmEditor, screenshotDir, step++, 'first-question-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We've typed our question: we're in Tokyo, it's raining, we're tired of sushi, and we want something Cyberpunk. 
      Let's ask the AI for a recommendation.`
    );

    // ── 5. Queue scripted answer, then click "Ask AI" ─────────────────
    await mainWindow.evaluate(
      (answer) => (window as any).electronAPI.queueScriptedAnswer(answer),
      aiAnswer1
    );

    const askAiButton = mainWindow.getByTestId('ask-ai-button').last();
    await takeStepScreenshotWithHighlight(mainWindow, askAiButton, screenshotDir, step++, 'highlight-ask-ai');
    writeNarration(
      screenshotDir,
      step++,
      `Now we'll click the "Ask AI" button to send our question.`
    );

    await demonstrateClickForDemo(askAiButton);

    // ── 6. Wait for the AI response to appear ─────────────────────────
    await expect(mainWindow.getByText('Head to Akihabara').first()).toBeVisible({ timeout: 30000 });
    await mainWindow.waitForTimeout(1000);

    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'first-ai-response');
    writeNarration(
      screenshotDir,
      step++,
      `The AI has responded. 
      It suggests heading to Akihabara and visiting an upper-floor retro arcade. 
      Neon reflections on wet pavement and 80s synth sounds — sounds like peak Cyberpunk. 
      Now let's ask a follow-up question.`
    );

    // ── 7. Click the "Reply" button ───────────────────────────────────
    const replyButton = mainWindow.getByTestId('ai-reply-button');
    await expect(replyButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, replyButton, screenshotDir, step++, 'highlight-reply');
    writeNarration(
      screenshotDir,
      step++,
      `Above the AI's answer, there's a Reply button. We'll click it to continue the conversation.`
    );

    await demonstrateClickForDemo(replyButton);

    // Wait for the reply editor to open
    await mainWindow.waitForTimeout(2000);

    // ── 8. Type the second question ───────────────────────────────────
    const replyEditor = mainWindow.locator('.cm-editor').first();
    await expect(replyEditor).toBeVisible({ timeout: 10000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'reply-editor-open');
    writeNarration(
      screenshotDir,
      step++,
      `A new editor has opened for our follow-up message. 
      Let's ask about a place to grab a drink afterward.`
    );

    await insertTextForDemo(mainWindow, humanMessage2, true);

    await takeStepScreenshotWithHighlight(mainWindow, replyEditor, screenshotDir, step++, 'second-question-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We've typed our follow-up: is there a quiet spot nearby for a drink? 
      Let's send it.`
    );

    // ── 9. Queue second scripted answer, then click "Ask AI" ──────────
    await mainWindow.evaluate(
      (answer) => (window as any).electronAPI.queueScriptedAnswer(answer),
      aiAnswer2
    );

    const askAiButton2 = mainWindow.getByTestId('ask-ai-button').last();
    await takeStepScreenshotWithHighlight(mainWindow, askAiButton2, screenshotDir, step++, 'highlight-ask-ai-2');
    writeNarration(
      screenshotDir,
      step++,
      `We'll click "Ask AI" one more time.`
    );

    await demonstrateClickForDemo(askAiButton2);

    // ── 10. Wait for the second AI response ───────────────────────────
    await expect(mainWindow.getByText("Check out 'Bar Sekirei.'").first()).toBeVisible({ timeout: 30000 });
    await mainWindow.waitForTimeout(1000);

    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'second-ai-response');
    writeNarration(
      screenshotDir,
      step++,
      `And there's our second answer. 
      The AI recommends Bar Sekirei, a hidden gem with a library-like atmosphere — the perfect calm after the storm to end the trip. 
      As you can see, having a multi-turn conversation with the AI is quick and seamless`
    );

    // ── 11. Explain Chat tab vs file system, highlight "Show in Browser" ──
    writeNarration(
      screenshotDir,
      step++,
      `This entire conversation was conducted in the Chat tab, but under the hood MkBrowser stores each exchange in real file system folders. That means you can browse, edit, or add files to any part of the conversation. Let's click one of the "Show in Browser" icons to jump into the underlying folders.`
    );

    const showInBrowserButton = mainWindow.getByTestId('show-in-browser-button').last();
    await expect(showInBrowserButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, showInBrowserButton, screenshotDir, step++, 'highlight-show-in-browser');
    writeNarration(
      screenshotDir,
      step++,
      `Here's the "Show in Browser" button. Clicking it will take us from the Chat tab into the actual folder on disk where this part of the conversation lives.`
    );

    await demonstrateClickForDemo(showInBrowserButton);

    // ── 12. Now in browser view ─────────────────
    await mainWindow.waitForTimeout(1000);

    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'browser-view-with-images');
    writeNarration(
      screenshotDir,
      step++,
      `We're now in the Browser tab, looking at the actual files and folders that make up this conversation.`
    );

    // ── 13. Highlight "Up Level" and navigate up ──────────────────────
    const upLevelButton = mainWindow.getByTestId('navigate-up-button');
    await expect(upLevelButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, upLevelButton, screenshotDir, step++, 'highlight-up-level');
    writeNarration(
      screenshotDir,
      step++,
      `We can explore earlier parts of the conversation by navigating up through the folder hierarchy. Let's click the "Up Level" button to go to the parent folder.`
    );

    await demonstrateClickForDemo(upLevelButton);
    await mainWindow.waitForTimeout(1000);

    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'parent-folder');
    writeNarration(
      screenshotDir,
      step++,
      `We've moved up one level. Let's go up once more to see an earlier turn of the conversation.`
    );

    // ── 14. Click "Up Level" again  ────────────
    await demonstrateClickForDemo(upLevelButton);
    await mainWindow.waitForTimeout(1000);

    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'earlier-turn-with-images');
    writeNarration(
      screenshotDir,
      step++,
      `Here we can see another turn of the conversation. 
      The ability to attach images, documents, or any other files alongside your chat makes MkBrowser's file-system-based conversation design uniquely powerful. Each exchange is a real folder you can organize, back up, share, and extend however you like.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
