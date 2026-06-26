import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demoClick, insertText, logScreenshotSummary, cleanupScreenshots, cleanupTestDataFiles, resetSettings } from './helpers/mediaUtils';

/**
 * E2E Demo Test — Custom Hashtags
 *
 * Demonstrates how a user defines a library of custom hashtags and then applies
 * them to a file. The flow is:
 *   1. Open the System Menu and go to the Settings view.
 *   2. Open the "Edit Hashtags" dialog to show where the hashtag library lives,
 *      then close it (no edits — it is self-explanatory).
 *   3. Return to the Browse view and create a new Markdown file.
 *   4. Reveal the tag picker in the editor and check a couple of tags
 *      (#p1 and #note), highlighting each as it is selected.
 *   5. Save the file and show the resulting tag "pills" rendered on the file.
 *
 * Like the other demo specs, every step captures a screenshot plus a companion
 * narration file for downstream video generation.
 */
test.describe('Custom Hashtags Demo', () => {
  test('define and apply custom hashtags to a file', async ({ mainWindow }) => {
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
      `Welcome to MkBrowser.
      In this demo we'll look at how you can define your own custom hashtags and then attach them to your files.
      Hashtags give you a simple, consistent way to label notes — for things like priority, type, or category — so they're easy to find later.
      Let's start by opening the System Menu so we can take a look at where our hashtags are defined.`
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

    // ── 3. Click the "Settings" menu item ─────────────────────────────
    const settingsItem = mainWindow.getByTestId('menu-settings');
    await expect(settingsItem).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, settingsItem, screenshotDir, step++, 'highlight-settings');
    writeNarration(
      screenshotDir,
      step++,
      `The System menu is open.
      Let's click the "Settings" option to open the Settings view.`
    );

    await demoClick(settingsItem);
    await mainWindow.waitForTimeout(500);

    // ── 4. Find and highlight the "Edit Hashtags" button ──────────────
    const editHashtagsButton = mainWindow.getByRole('button', { name: 'Edit Hashtags' });
    await expect(editHashtagsButton).toBeVisible({ timeout: 5000 });
    await editHashtagsButton.scrollIntoViewIfNeeded();
    await mainWindow.waitForTimeout(300);
    await takeScreenshot(mainWindow, editHashtagsButton, screenshotDir, step++, 'highlight-edit-hashtags');
    writeNarration(
      screenshotDir,
      step++,
      `We're now in the Settings view.
      Down at the bottom is an "Edit Hashtags" button.
      This is where we manage the full library of hashtags that are available across all of our files.
      Let's click it to open the hashtag editor.`
    );

    await demoClick(editHashtagsButton);
    await mainWindow.waitForTimeout(500);

    // ── 5. Show the Tags Editor dialog ────────────────────────────────
    await expect(mainWindow.getByText('Categories', { exact: true })).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'tags-editor-open');
    writeNarration(
      screenshotDir,
      step++,
      `Here is the hashtag editor.
      On the left we have our categories — things like priority and type — and on the right are the individual tags that belong to the selected category.
      From here you can rename categories, add new ones, and create or edit tags along with a short description for each.
      We won't make any changes right now — we just wanted to show you where your hashtags live.
      Let's close this dialog and go put some of these tags to use.`
    );

    // ── 6. Close the dialog with Cancel (no changes) ──────────────────
    const cancelButton = mainWindow.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancelButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, cancelButton, screenshotDir, step++, 'highlight-cancel');
    writeNarration(
      screenshotDir,
      step++,
      `We'll click "Cancel" to close the editor without making any changes.`
    );

    await demoClick(cancelButton);
    await mainWindow.waitForTimeout(500);

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
      Let's create a brand new file and then tag it using the hashtags we just looked at.`
    );

    // ── 8. Create a new file named "my-weekend-tasks" ─────────────────
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
    await insertText(mainWindow, 'my-weekend-tasks', true, filenameInput);

    await takeScreenshot(mainWindow, filenameInput, screenshotDir, step++, 'filename-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We've named the file "my-weekend-tasks".
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

    // ── 9. Type a little content so the note has a body ───────────────
    const cmEditor = mainWindow.locator('.cm-editor').first();
    await expect(cmEditor).toBeVisible({ timeout: 10000 });
    await insertText(mainWindow, '# Weekend Tasks\n\nClean out the garage and call the plumber about the leaking sink.', true);

    await takeScreenshot(mainWindow, cmEditor, screenshotDir, step++, 'content-typed');
    writeNarration(
      screenshotDir,
      step++,
      `We've typed a quick note into the editor.
      Now let's tag this file so it's easy to find later.`
    );

    // ── 10. Reveal the tag picker with the toolbar button ─────────────
    // The toolbar tag toggle has no testid; locate it by its tooltip title.
    // Its visible state is persisted in config across runs, so it may already
    // be showing. Make sure it starts hidden (clicking silently if needed) so
    // our demo click below actually *reveals* the picker rather than hiding it.
    const tagToggle = mainWindow.locator('button[title="Show tags"], button[title="Hide tags"]').first();
    await expect(tagToggle).toBeVisible({ timeout: 5000 });
    if ((await tagToggle.getAttribute('title')) === 'Hide tags') {
      await tagToggle.click();
      await mainWindow.waitForTimeout(400);
    }
    await takeScreenshot(mainWindow, tagToggle, screenshotDir, step++, 'highlight-show-tags');
    writeNarration(
      screenshotDir,
      step++,
      `Up here in the editor toolbar is a tag button.
      Clicking it reveals the tag picker, which lets us add or remove hashtags without typing them by hand.
      Let's click it now.`
    );

    await demoClick(tagToggle);
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'tag-picker-open');
    writeNarration(
      screenshotDir,
      step++,
      `The tag picker is now showing, just above the editor.
      Our hashtags are grouped by category, exactly the way we saw them in the hashtag editor.
      Let's check a couple of them to attach them to this file.`
    );

    // ── 11. Check the "#p1" priority tag ──────────────────────────────
    const p1Tag = mainWindow.locator('label').filter({ hasText: '#p1' });
    await expect(p1Tag).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, p1Tag, screenshotDir, step++, 'highlight-p1-tag');
    writeNarration(
      screenshotDir,
      step++,
      `First, let's mark this as high priority by checking the "p1" tag in the priority category.`
    );

    await demoClick(p1Tag);
    await mainWindow.waitForTimeout(500);

    // ── 12. Check the "#note" type tag ────────────────────────────────
    const noteTag = mainWindow.locator('label').filter({ hasText: '#note' });
    await expect(noteTag).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, noteTag, screenshotDir, step++, 'highlight-note-tag');
    writeNarration(
      screenshotDir,
      step++,
      `Next, let's classify it by checking the "note" tag in the type category.`
    );

    await demoClick(noteTag);
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'tags-selected');
    writeNarration(
      screenshotDir,
      step++,
      `Both tags are now checked, and they're highlighted in blue to show they've been applied.
      Behind the scenes, MkBrowser has added these hashtags to the file's front matter for us.
      Now let's save the file.`
    );

    // ── 13. Save the file ─────────────────────────────────────────────
    const saveButton = mainWindow.getByTestId('entry-save-button');
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, saveButton, screenshotDir, step++, 'highlight-save');
    writeNarration(
      screenshotDir,
      step++,
      `Let's click "Save" to write our changes to disk.`
    );

    await demoClick(saveButton);

    // Verify the save completed (the editor closes, hiding its Save button).
    await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });
    await mainWindow.waitForTimeout(500);

    // ── 14. Show the rendered tag pills on the saved file ─────────────
    const taggedEntry = mainWindow
      .locator('[data-testid="browser-entry-markdown"]')
      .filter({ hasText: 'Weekend Tasks' });
    await taggedEntry.scrollIntoViewIfNeeded();
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'tag-pills-shown');
    writeNarration(
      screenshotDir,
      step++,
      `The file is saved, and we can now see our two hashtags displayed as pills right above the file's content.
      That's all there is to it — define your hashtags once, then apply them to any file with a couple of clicks to keep your notes organized and easy to search.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
