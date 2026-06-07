import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demoClick, insertText, logScreenshotSummary, cleanupScreenshots, cleanupTestDataFiles } from './helpers/mediaUtils';

/**
 * E2E Demo Test — AI Rewrite with a Custom Persona
 *
 * Demonstrates how a user can give their AI agent a custom personality (a
 * "Persona") and then use the "AI Rewrite" feature to co-author a document —
 * letting the agent rewrite their draft in the persona's voice.
 *
 * This file is built up across several phases. Phase 1 covers selecting the
 * "Hemingway" persona in AI Settings, enabling AI Rewrite mode, creating a new
 * file, typing a rough draft, and kicking off an AI Rewrite of the whole file.
 *
 * NOTE: This is a work-in-progress demo. Narrations are written assuming more
 * of the demo follows — they should not sound like an ending.
 */
test.describe('AI Rewrite Persona Demo', () => {
  test('define an AI persona and rewrite a document with it', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();

    // Remove any leftover file from a previous run so the Create File step is
    // always working with a clean slate.
    const testDataDir = path.resolve(path.join(__dirname, '../../mkbrowser-test'));
    fs.rmSync(path.join(testDataDir, 'scary-novel.md'), { force: true });

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
      In this demo we're going to look at how you can define a personality for your AI agent, which we call a Persona,
      and then have that agent rewrite text for you using the "AI Rewrite" feature.
      Let's start by opening the System Menu to get to the AI Settings view.`
    );

    // ── 2. Open the System popup menu ─────────────────────────────────
    const systemMenuButton = mainWindow.getByTestId('system-menu-button');
    await expect(systemMenuButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, systemMenuButton, screenshotDir, step++, 'highlight-system-menu');
    writeNarration(
      screenshotDir,
      step++,
      `Here in the top right corner is the System Menu button.
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
      Let's click the "AI Settings" option to open the AI Settings view.`
    );

    await demoClick(aiSettingsItem);
    await mainWindow.waitForTimeout(500);

    // ── 4. Locate the persona combobox and scroll it into view ────────
    const personaCombobox = mainWindow.getByTestId('ai-persona-combobox');
    await expect(personaCombobox).toBeVisible({ timeout: 5000 });
    await personaCombobox.scrollIntoViewIfNeeded();
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, personaCombobox, screenshotDir, step++, 'highlight-persona-combobox');
    writeNarration(
      screenshotDir,
      step++,
      `We're now in the AI Settings view.
      Down here in the AI Personas section is where we can define our personas and select the active one.
      Let's open it to see the personas we have defined.`
    );

    // ── 5. Open the dropdown and select the "Hemingway" persona ───────
    await demoClick(personaCombobox);

    const hemingwayOption = mainWindow.getByRole('option', { name: 'Hemingway', exact: true });
    await expect(hemingwayOption).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, hemingwayOption, screenshotDir, step++, 'highlight-hemingway-option');
    writeNarration(
      screenshotDir,
      step++,
      `The dropdown is open, showing the personas we've defined.
      Let's select the "Hemingway" persona.`
    );

    await demoClick(hemingwayOption);
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, personaCombobox, screenshotDir, step++, 'hemingway-selected');
    writeNarration(
      screenshotDir,
      step++,
      `We now have a persona selected that tells the AI to write in the spare, punchy style of Ernest Hemingway.
      Whatever text we hand it will come back sounding like Hemingway wrote it.`
    );

    // ── 6. Enable AI Rewrite, and full-document context ───────────────
    // These two settings may already be on from a previous session, so rather
    // than blindly toggling them (which would turn them OFF if already on) we
    // make sure they each END UP checked, only clicking when needed.
    const enableRewrite = mainWindow.getByTestId('enable-ai-rewrite');
    await enableRewrite.scrollIntoViewIfNeeded();
    await mainWindow.waitForTimeout(300);
    await expect(enableRewrite).toBeVisible({ timeout: 5000 });
    if (!(await enableRewrite.isChecked())) {
      await demoClick(enableRewrite);
      await mainWindow.waitForTimeout(300);
    }
    await expect(enableRewrite).toBeChecked();

    await takeScreenshot(mainWindow, enableRewrite, screenshotDir, step++, 'highlight-enable-ai-rewrite');
    writeNarration(
      screenshotDir,
      step++,
      `Down in the AI Rewrite Options section we've turned on the "AI Rewrite" feature.
      You can see its checkbox is now checked.`
    );

    // Enabling AI Rewrite reveals the "Full Doc Context" option.
    const fullDocContext = mainWindow.getByTestId('rewrite-using-full-doc-context');
    await fullDocContext.scrollIntoViewIfNeeded();
    await mainWindow.waitForTimeout(300);
    await expect(fullDocContext).toBeVisible({ timeout: 5000 });
    if (!(await fullDocContext.isChecked())) {
      await demoClick(fullDocContext);
      await mainWindow.waitForTimeout(300);
    }
    await expect(fullDocContext).toBeChecked();

    await takeScreenshot(mainWindow, fullDocContext, screenshotDir, step++, 'highlight-full-doc-context');
    writeNarration(
      screenshotDir,
      step++,
      `We've also enabled "Rewrite using Full Doc Context", which is now checked too.
      This lets the agent see the entire document when it rewrites, instead of just a selection.`
    );

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'rewrite-options-enabled');
    writeNarration(
      screenshotDir,
      step++,
      `Both options are switched on now, so AI Rewrite is ready to use with our full document as context.`
    );

    // ── 7. Switch back to the Browse view ─────────────────────────────
    const tabBar = mainWindow.getByTestId('app-tab-buttons');
    const browseTab = tabBar.getByTestId('tab-button-browser');
    await expect(browseTab).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, browseTab, screenshotDir, step++, 'highlight-browse-tab');
    writeNarration(
      screenshotDir,
      step++,
      `Now we'll click the "Browse" tab to switch back to the Browse view.`
    );

    await demoClick(browseTab);
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'back-in-browse-view');
    writeNarration(
      screenshotDir,
      step++,
      `We're back in the Browse view.
      Let's create a new file and then let our agent help us write some content into it.
      This is what we mean by co-authoring a document.`
    );

    // ── 8. Create a new file named "scary-novel" ──────────────────────
    const createButton = mainWindow.getByTestId('create-file-button');
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, createButton, screenshotDir, step++, 'highlight-create-file');
    writeNarration(
      screenshotDir,
      step++,
      `We'll click the "Create File" button at the top of the window to add a new file to our folder.`
    );

    await demoClick(createButton);

    const filenameInput = mainWindow.getByTestId('create-file-dialog-input');
    await expect(filenameInput).toBeVisible({ timeout: 5000 });
    await insertText(mainWindow, 'scary-novel', true, filenameInput);

    await takeScreenshot(mainWindow, filenameInput, screenshotDir, step++, 'filename-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We've named the file "scary-novel".
      MkBrowser will automatically add the ".md" extension for us.`
    );

    const createDialogButton = mainWindow.getByTestId('create-file-dialog-create-button');
    await takeScreenshot(mainWindow, createDialogButton, screenshotDir, step++, 'about-to-create-file');
    writeNarration(
      screenshotDir,
      step++,
      `Now we'll click the "Create" button to confirm and open the new file in the editor.`
    );

    await demoClick(createDialogButton);
    await mainWindow.waitForTimeout(1000);

    // ── 9. Type our rough draft into the editor ───────────────────────
    const cmEditor = mainWindow.locator('.cm-editor').first();
    await expect(cmEditor).toBeVisible({ timeout: 10000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'editor-open');
    writeNarration(
      screenshotDir,
      step++,
      `The file is open in the editor.
      Let's type out a rough draft of the opening to a scary story.`
    );

    const draft = `Then he heard the sound again outside the cottage door. It was a creepy sound. Not a scraping and not a thump, but a little of both. The hairs stood up on the back of his neck and his arms, and suddenly he was sure there was something out there.

Slowly he got up from the chair reaching for his...`;
    await insertText(mainWindow, draft, true);

    // After typing, the last line of the draft sits right at the very bottom of
    // the window, which looks cramped. Nudge the scroll container down a further
    // 100px so there's a little breathing room below the text.
    await mainWindow.evaluate(() => {
      const scrollers = Array.from(document.querySelectorAll('main, [class*="overflow-y-auto"]'));
      const scroller = scrollers.find((el) => el.scrollHeight > el.clientHeight);
      if (scroller) scroller.scrollTop = scroller.scrollTop + 100;
    });
    await mainWindow.waitForTimeout(300);

    await takeScreenshot(mainWindow, cmEditor, screenshotDir, step++, 'draft-typed');
    writeNarration(
      screenshotDir,
      step++,
      `We've typed our rough draft.
      This is the text we want the AI to rewrite for us.`
    );

    // ── 10. Kick off the AI Rewrite of the whole document ─────────────
    // Queue a scripted (mocked) answer so the rewrite LLM call returns this
    // fixed Hemingway-style passage instead of hitting a real model. The full
    // -document rewrite returns this text verbatim as the "modified" side of
    // the diff. (See queueScriptedAnswer / consumeScriptedAnswer in the main
    // process — scripted answers resolve immediately and emit no stream events,
    // so review mode is entered right away.)
    const rewrittenText = `Then, through the heavy, stagnant air of the room, he heard it again. The sound came from just beyond the cottage door, cutting through the silence like a dull blade. It was not a sound one could easily name. It was not the clean scrape of a branch against stone, nor was it the sudden, honest thump of a falling weight. It was something more complex and more terrible—a rhythmic, unsettling fusion of both, a sliding weight that seemed to drag itself across the threshold.

A sudden, cold electricity surged through him. The hairs on the nape of his neck rose, stiff and sharp, and a similar prickling sensation raced down the length of his arms, as if the very air had turned to needles. In that moment, the uncertainty that had plagued his thoughts for hours vanished, replaced by a hard, crystalline certainty. There was something out there. Something waiting in the dark, breathing the same warm summer night.

With a deliberate, agonizing slowness, he rose from the chair. His movements were heavy, as if he were moving through deep water, and his heart beat a steady, hollow rhythm against his ribs. He reached out, his fingers trembling slightly, searching for his...`;
    await mainWindow.evaluate(
      (answer) => (window as any).electronAPI.queueScriptedAnswer(answer),
      rewrittenText
    );

    // Because we enabled rewrite mode, a purple "AI Rewrite" button is available
    // on the editor toolbar. With nothing selected it rewrites the entire file.
    const aiRewriteButton = mainWindow.getByRole('button', { name: 'AI Rewrite', exact: true });
    await expect(aiRewriteButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, aiRewriteButton, screenshotDir, step++, 'highlight-ai-rewrite');
    writeNarration(
      screenshotDir,
      step++,
      `Because we enabled rewrite mode, the editor now has an "AI Rewrite" button.
      Since nothing is selected, clicking it will rewrite the entire file in the style of Hemingway.
      Let's click it now.`
    );

    await demoClick(aiRewriteButton);

    // ── 11. The diff review appears — original vs the AI's rewrite ────
    // Entering review mode swaps the editor for the DiffReviewEditor, which
    // shows the original text struck through and the rewritten text inline.
    const diffDoneButton = mainWindow.getByTestId('diff-done-button');
    await expect(diffDoneButton).toBeVisible({ timeout: 30000 });
    await expect(mainWindow.getByText('cutting through the silence').first()).toBeVisible({ timeout: 10000 });
    await mainWindow.waitForTimeout(1000);

    // The diff viewer is tall and lands near the bottom of the page, so most of
    // it is clipped. Scroll its top (the amber-bordered container) up to the top
    // of the viewport so as much of the diff as possible is visible.
    await mainWindow.evaluate(() => {
      const diff = document.querySelector('.border-amber-600') as HTMLElement | null;
      diff?.scrollIntoView({ block: 'start' });
    });
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'diff-review-shown');
    writeNarration(
      screenshotDir,
      step++,
      `The agent has rewritten our draft, and we're now looking at a diff review.
      Our original lines are shown struck through, with the new Hemingway-style version in their place.
      From here we can accept or reject the changes before anything is saved.`
    );

    // ── 12. Accept every change at once with "Accept All" ─────────────
    // "Accept All" applies all of the agent's changes and returns us straight
    // to the editor in a single click. We use it (rather than accepting each
    // chunk and then clicking "Done") so there's only one click in this step —
    // accepting chunk-by-chunk shrinks the diff between clicks, which can leave
    // a later click landing on a background file and opening it for editing.
    const acceptAllButton = mainWindow.getByTestId('diff-accept-all-button');
    await expect(acceptAllButton).toBeVisible({ timeout: 5000 });
    await acceptAllButton.scrollIntoViewIfNeeded();
    await mainWindow.waitForTimeout(300);
    await takeScreenshot(mainWindow, acceptAllButton, screenshotDir, step++, 'highlight-accept-all');
    writeNarration(
      screenshotDir,
      step++,
      `We're happy with the rewrite, so let's click "Accept All" to apply every change and return to the editor.`
    );

    await demoClick(acceptAllButton);
    await mainWindow.waitForTimeout(1000);

    // ── 14. Back in the editor — save the rewritten document ──────────
    // Editing state is tracked per file, and clicking a file's body opens it
    // for editing. During the demo an automated click can occasionally land on
    // a background file (e.g. if the page scrolls between Playwright computing
    // the click point and dispatching it), leaving a second entry stuck in edit
    // mode. That would put more than one "entry-save-button" on the page. Close
    // any such stray editors now, leaving only the document we actually
    // rewrote. We identify ours by the unique first line of the rewritten text.
    const REWRITE_MARKER = 'Then, through the heavy';
    for (let i = 0; i < 10; i++) {
      const strayEditors = mainWindow
        .locator('[data-testid="browser-entry-markdown"], [data-testid="browser-entry-text"]')
        .filter({ has: mainWindow.getByTestId('entry-cancel-button') })
        .filter({ hasNotText: REWRITE_MARKER });
      if ((await strayEditors.count()) === 0) break;
      await strayEditors.first().getByTestId('entry-cancel-button').first().click();
      await mainWindow.waitForTimeout(200);
    }

    // Scope all remaining actions to the scary-novel entry so we always act on
    // the document we just rewrote.
    const novelEntry = mainWindow
      .locator('[data-testid="browser-entry-markdown"]')
      .filter({ hasText: REWRITE_MARKER });
    const cmEditorAfter = novelEntry.locator('.cm-editor').first();
    await expect(cmEditorAfter).toBeVisible({ timeout: 10000 });
    await takeScreenshot(mainWindow, cmEditorAfter, screenshotDir, step++, 'rewrite-in-editor');
    writeNarration(
      screenshotDir,
      step++,
      `We're back in the editor, and our document now holds the rewritten, Hemingway-style passage.
      All that's left is to save it.`
    );

    const saveButton = novelEntry.getByTestId('entry-save-button');
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, saveButton, screenshotDir, step++, 'highlight-save');
    writeNarration(
      screenshotDir,
      step++,
      `Let's click "Save" to write the rewritten document to disk.`
    );

    await demoClick(saveButton);

    // Verify the save completed (this entry's editor closes, hiding its Save button).
    await expect(novelEntry.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });
    await mainWindow.waitForTimeout(500);

    // Saving collapses the tall editor back to rendered markdown, which can
    // shift the scroll position so our file ends up off-screen. Silently scroll
    // it back into view before the final screenshot.
    await novelEntry.scrollIntoViewIfNeeded();
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'rewrite-saved');
    writeNarration(
      screenshotDir,
      step++,
      `The file is saved, and our rewritten passage is now rendered right here in the document.
      Our agent has co-authored this draft with us, rewriting it in the style of Hemingway.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
