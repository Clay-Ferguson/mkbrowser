import { test, expect } from './fixtures/electronApp';
import { takeStepScreenshot, takeStepScreenshotWithHighlight, writeNarration, demonstrateClickForDemo, insertTextForDemo, logScreenshotSummary, cleanupScreenshots } from './helpers/mediaUtils';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E Demo Test — AI Vision Query
 *
 * Walks through an AI vision query on an image of Mont Saint-Michel,
 * using a scripted (mocked) AI answer so the demo is deterministic.
 * Captures screenshots and narration at every step for GIF/MP4 assembly.
 */
test.describe('AI Vision Demo', () => {
  test('demonstrate an AI vision query on an image', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);

    // Clean up any previously created AI chat folders (H, H1, H2, …), HUMAN.md files,
    // and A folders inside ai-vision-demo
    const visionDemoDir = path.join(__dirname, '../../mkbrowser-test/ai-vision-demo');
    for (const entry of fs.readdirSync(visionDemoDir, { withFileTypes: true })) {
      const entryPath = path.join(visionDemoDir, entry.name);
      if (entry.isDirectory() && (/^H\d*$/.test(entry.name) || entry.name === 'A')) {
        fs.rmSync(entryPath, { recursive: true, force: true });
      } else if (!entry.isDirectory() && entry.name === 'HUMAN.md') {
        fs.rmSync(entryPath, { force: true });
      }
    }

    const aiAnswer =
      `- What's in the image: Mont Saint-Michel—the iconic tidal island with a medieval abbey at the top and a village on the slopes. It's lit up, with water and marshes around that reflect the lights.

- Where it's located: Mont Saint-Michel, in Normandy, France (off the coast in the bay near Avranches, Manche). It's a famous UNESCO World Heritage site.`;

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // ── 1. Initial state ──────────────────────────────────────────────
    await expect(mainWindow.getByText('sample.md')).toBeVisible({ timeout: 10000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. 
      Today we'll demonstrate the AI Vision feature, which lets you ask an AI questions about images right from your file browser.`
    );

    // ── 2. Highlight and navigate into ai-vision-demo folder ──────────
    const visionFolder = mainWindow.getByText('ai-vision-demo');
    await expect(visionFolder).toBeVisible({ timeout: 10000 });
    await takeStepScreenshotWithHighlight(mainWindow, visionFolder, screenshotDir, step++, 'highlight-vision-folder');
    writeNarration(
      screenshotDir,
      step++,
      `We can see the vision demo folder in our file list. 
      Let's go into it to see the image we'll be asking about.`
    );

    await demonstrateClickForDemo(visionFolder);
    await mainWindow.waitForTimeout(1500);

    // ── 3. Screenshot the image view ──────────────────────────────────
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'image-visible');
    writeNarration(
      screenshotDir,
      step++,
      `Now we can see the image we're going to ask the AI about. 
      Let's find out what this place is.`
    );

    // ── 4. Silent validation — ensure folder is clean ─────────────────
    const folderFiles = fs.readdirSync(visionDemoDir).filter(f => {
      return !fs.statSync(path.join(visionDemoDir, f)).isDirectory();
    });
    if (folderFiles.length !== 1 || folderFiles[0] !== 'mystery-location.png') {
      throw new Error(
        `The ai-vision-demo folder must contain only "mystery-location.png" for this test. ` +
        `Found: ${folderFiles.join(', ') || '(empty)'}`
      );
    }

    // ── 5. Open Tools menu ────────────────────────────────────────────
    const toolsMenuButton = mainWindow.getByTestId('tools-menu-button');
    await expect(toolsMenuButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, toolsMenuButton, screenshotDir, step++, 'highlight-tools-menu');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's click the Tools menu to start a new AI chat.`
    );

    await demonstrateClickForDemo(toolsMenuButton);

    // ── 6. Click "New AI Chat" ────────────────────────────────────────
    const newAiChatItem = mainWindow.getByTestId('menu-new-ai-chat');
    await expect(newAiChatItem).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, newAiChatItem, screenshotDir, step++, 'highlight-new-ai-chat');
    writeNarration(
      screenshotDir,
      step++,
      `The Tools menu is open. 
      We'll click "New AI Chat" to start our vision query.`
    );

    await demonstrateClickForDemo(newAiChatItem);
    await mainWindow.waitForTimeout(2000);

    // ── 7. Now on the Chat tab — screenshot and narrate ───────────────
    const cmEditor = mainWindow.locator('.cm-editor').first();
    await expect(cmEditor).toBeVisible({ timeout: 10000 });
    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'chat-tab-open');
    writeNarration(
      screenshotDir,
      step++,
      `We're now on the Chat tab view with the editor open. 
      This is where we'll enter our question about the image.`
    );

    // ── 8. Type the prompt ────────────────────────────────────────────
    const promptText = `What's in this image? Where is this located?\n\n#file:*`;
    await insertTextForDemo(mainWindow, promptText, true);

    await takeStepScreenshotWithHighlight(mainWindow, cmEditor, screenshotDir, step++, 'prompt-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We've entered our prompt asking what's in the image and where it's located. 
      Notice the special hash file colon star directive at the end. This is called a file directive, and the asterisk is a wildcard that tells the AI to include all files in the current folder, which means the image we just saw will be sent along with our question.`
    );

    // ── 9. Queue the scripted AI answer ───────────────────────────────
    await mainWindow.evaluate(
      (answer) => (window as any).electronAPI.queueScriptedAnswer(answer),
      aiAnswer
    );

    // ── 10. Click "Ask AI" ────────────────────────────────────────────
    const askAiButton = mainWindow.getByTestId('ask-ai-button').last();
    await expect(askAiButton).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, askAiButton, screenshotDir, step++, 'highlight-ask-ai');
    writeNarration(
      screenshotDir,
      step++,
      `Now we'll click the "Ask AI" button to send the image along with our question.`
    );

    await demonstrateClickForDemo(askAiButton);

    // ── 11. Wait for the AI response ──────────────────────────────────
    await mainWindow.waitForTimeout(1000);

    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'ai-response-visible');
    writeNarration(
      screenshotDir,
      step++,
      `We now have our answer. 
      The AI identified the image as Mont Saint-Michel, the iconic tidal island in Normandy, France.`
    );

    // ── 12. Switch to Browse tab ──────────────────────────────────────
    const browseTab = mainWindow.getByTestId('tab-button-browser');
    await expect(browseTab).toBeVisible({ timeout: 5000 });
    await takeStepScreenshotWithHighlight(mainWindow, browseTab, screenshotDir, step++, 'highlight-browse-tab');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's go back to the Browse tab to see our files and folders.`
    );

    await demonstrateClickForDemo(browseTab);
    await mainWindow.waitForTimeout(1000);

    // ── 13. Navigate up one level ─────────────────────────────────────
    const upLevelButton = mainWindow.getByTestId('navigate-up-button');
    await expect(upLevelButton).toBeVisible({ timeout: 5000 });
    writeNarration(
      screenshotDir,
      step++,
      `We'll click the "Up Level" button to go back up one level in the folder hierarchy to see where we started.`
    );
    await takeStepScreenshotWithHighlight(mainWindow, upLevelButton, screenshotDir, step++, 'highlight-up-level');

    await demonstrateClickForDemo(upLevelButton);
    await mainWindow.waitForTimeout(1000);

    await takeStepScreenshot(mainWindow, screenshotDir, step++, 'back-at-start');
    writeNarration(
      screenshotDir,
      step++,
      `We're now back where we started, and we can see that the AI's answer folder has been created alongside our original image. From here, we can continue the conversation by branching at any point, and we can do it all from the Browse tab or from the Chat tab.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
