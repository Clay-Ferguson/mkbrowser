import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot,
  writeNarration,
  demoClick,
  demoRightClick,
  logScreenshotSummary,
  cleanupScreenshots,
  cleanupTestDataFiles,
  resetSettings,
} from './helpers/mediaUtils';

/**
 * Private E2E Test: Thesaurus strip
 *
 * Once the feature is switched on from the editor's right-click menu, a strip below the
 * editor shows synonyms for the word under the cursor — with no further gesture from the
 * user beyond parking the cursor there for a moment.
 *
 * Almost none of that is checkable by unit tests: the word travels from a CodeMirror view
 * plugin, through the store, into a component that looks it up over IPC, in a process that
 * has to find a ~2 MB data file shipped in `resources/`. This test is the only thing that
 * exercises the whole chain, so it covers:
 *
 *   1. Nothing is rendered until the feature is enabled — not while browsing, and not on
 *      opening the editor either, since `enableThesaurus` is off by default.
 *   2. "Enable Thesaurus" in the editor's context menu brings the strip up mid-edit. That
 *      it works on the already-open editor is the point: the extension list is built once
 *      when CodeMirror mounts, so an implementation that captured the flag there would
 *      leave the strip inert until the next edit.
 *   3. Parking the cursor on a word produces that word's synonyms, unprompted — including
 *      for an inflected word, which is answered from its base form.
 *   4. Moving the cursor to a different word replaces them. This is the assertion that
 *      matters most: a strip that shows the first word forever would pass a weaker test.
 *   5. "Disable Thesaurus" takes the strip out of the DOM entirely — the editor gets that
 *      height back rather than keeping a row of chrome around — and re-enabling brings the
 *      synonyms back.
 *   6. Clicking a pill inserts that synonym after the word, back in the editor. This is
 *      the strip → editor direction, which no other test can reach: the store channel
 *      only runs editor → strip, so the click depends on the plugin having handed over a
 *      live `EditorView`.
 *   7. Ending the edit takes the strip away again.
 *
 * This test is private (not part of the demo video set) — it still writes
 * screenshots/narration per the shared conventions, but its purpose is
 * automated verification.
 */
test.describe('Private: Thesaurus', () => {
  test('shows synonyms for the word under the editor cursor while editing', async ({ mainWindow, testDataPath }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // --- Seed on disk ------------------------------------------------------
    // A plain-text file, so there is no front matter to navigate around and no rendered
    // Markdown between the click and the editor.
    //
    // The body is written so the two words under test sit at positions the keyboard can
    // reach exactly: "beautiful" starts the document (Control+Home) and "replied" ends it
    // (Control+End). Note the deliberate absence of a trailing newline — with one,
    // Control+End would land on an empty last line and find no word at all.
    //
    // "replied" is there to exercise lemmatization: the thesaurus is indexed by base forms
    // and has no entry of its own for it, so answering it at all means the lookup reduced it
    // to "reply". (An inflected word is not automatically a good test of this — "shouted",
    // for one, has its own entry as an adjective and never reaches the lemmatizer.)
    const folderName = 'my-thesaurus-folder';
    const folderPath = path.join(testDataPath, folderName);
    const targetName = 'my-thesaurus-target.txt';
    fs.rmSync(folderPath, { recursive: true, force: true });
    fs.mkdirSync(folderPath);
    fs.writeFileSync(
      path.join(folderPath, targetName),
      'beautiful scenery filled the valley\n\nthe witness replied'
    );

    let step = 1;

    await mainWindow.waitForTimeout(2000);

    // The folder was created after the app read the directory, so refresh.
    await demoClick(mainWindow.getByTestId('refresh-button'));

    const listing = mainWindow.getByTestId('browser-main-content');
    await demoClick(listing.getByText(folderName, { exact: true }));
    await expect(listing.getByText(targetName, { exact: true })).toBeVisible({ timeout: 10000 });

    // --- Phase 1: open the file on its own ---------------------------------
    const tree = mainWindow.getByTestId('file-explorer-tree');
    await expect(tree).toBeVisible({ timeout: 10000 });
    await demoClick(tree.getByText(folderName, { exact: true }).first());

    const treeTarget = tree.getByText(targetName, { exact: true }).first();
    await treeTarget.scrollIntoViewIfNeeded();
    await demoClick(treeTarget);

    const single = mainWindow.getByTestId('browse-file-main-content');
    await expect(single).toBeVisible({ timeout: 10000 });

    // Browsing is not editing, so there is no strip yet. Asserted before the edit starts,
    // so a strip that rendered unconditionally could not slip through.
    await expect(mainWindow.getByTestId('thesaurus-view')).toHaveCount(0);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'browsing-no-thesaurus');
    writeNarration(
      screenshotDir,
      step++,
      `We're browsing a single text file. There's no thesaurus in sight — it belongs to editing, not reading.`
    );

    // --- Phase 2: start editing, then switch the thesaurus on ----------------
    await demoClick(single.locator('.cm-content'));
    await expect(mainWindow.getByTestId('entry-save-button')).toBeVisible({ timeout: 10000 });

    // Still nothing: the feature is off by default, and off means the strip is not in the
    // DOM at all, so the editor keeps the full height of the pane.
    const thesaurus = mainWindow.getByTestId('thesaurus-view');
    await expect(thesaurus).toHaveCount(0);

    // Turning it on has to work on the editor that is already open: the extension list is
    // built once when CodeMirror mounts, so an implementation that captured the flag there
    // would leave the strip inert (or, worse, keep scanning while off) until the next edit.
    await demoRightClick(single.locator('.cm-content'));
    const toggleThesaurus = mainWindow.getByTestId('editor-toggle-thesaurus');
    await expect(toggleThesaurus).toHaveText('Enable Thesaurus');
    await demoClick(toggleThesaurus);

    await expect(thesaurus).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, thesaurus, screenshotDir, step++, 'editing-thesaurus-enabled');
    writeNarration(
      screenshotDir,
      step++,
      `Right-click in the editor and pick "Enable Thesaurus". A slim strip appears along the bottom, waiting for us to put the cursor on a word. Until we ask for it, it takes up no room at all.`
    );

    // --- Phase 3: park the cursor on an inflected word ----------------------
    // The menu item handed focus back to the editor when it closed, so this keystroke goes
    // to the document — and the plugin only reports from the editor that has focus.
    // Control+End lands just past "replied", the last word in the document. The plugin waits
    // for the cursor to be still for ~2s, so the assertion's own timeout is what waits.
    await mainWindow.keyboard.press('Control+End');

    const synonyms = mainWindow.getByTestId('thesaurus-synonyms');
    await expect(synonyms).toBeVisible({ timeout: 15000 });
    await expect(synonyms.getByRole('button', { name: 'answer', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(synonyms.getByRole('button', { name: 'response', exact: true })).toBeVisible();

    // "replied" has no entry of its own — these are "reply"'s synonyms, and the label says
    // so rather than leaving the user to wonder why the tenses don't line up.
    await expect(mainWindow.getByTestId('thesaurus-label')).toHaveText('reply');

    await takeScreenshot(mainWindow, thesaurus, screenshotDir, step++, 'synonyms-for-replied');
    writeNarration(
      screenshotDir,
      step++,
      `The cursor is sitting on the word "replied". After a moment's pause, synonyms appear along the bottom — answer, response, respond. We never asked for them.
The thesaurus is indexed by base words, so there's no entry for "replied" itself; it was reduced to "reply" behind the scenes. The label on the left tells you that's what happened.`
    );

    // --- Phase 4: move to a different word ----------------------------------
    // Control+Home puts the cursor at the start of "beautiful". The strip must follow the
    // cursor: showing "replied"'s synonyms forever would satisfy Phase 3 on its own.
    await mainWindow.keyboard.press('Control+Home');

    await expect(synonyms.getByRole('button', { name: 'gorgeous', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(synonyms.getByRole('button', { name: 'lovely', exact: true })).toBeVisible();
    // The previous word's synonyms are gone, not merely pushed down the list.
    await expect(synonyms.getByRole('button', { name: 'answer', exact: true })).toHaveCount(0);
    // "beautiful" is an entry in its own right, so there is no base form to disclose and the
    // label disappears entirely, leaving the whole strip to the synonyms.
    await expect(mainWindow.getByTestId('thesaurus-label')).toHaveCount(0);

    await takeScreenshot(mainWindow, thesaurus, screenshotDir, step++, 'synonyms-for-beautiful');
    writeNarration(
      screenshotDir,
      step++,
      `Move the cursor to another word — here, "beautiful" at the top of the file — and the strip follows along, swapping in synonyms for that word instead. This one has its own entry, so there's no base form to point out and the whole strip is synonyms.`
    );

    // The editor still owns the screen. This is a runaway guard, not a pixel spec: the
    // strip's ceiling is `PILL_ROWS` (8) rows of pills plus its padding, and the fraction
    // below is that ceiling with a little room, so only a change that defeats the scroll
    // cap trips it. The bound is deliberately loose of what this word actually renders,
    // since the row count is content- and width-dependent.
    const paneBox = await single.boundingBox();
    const stripBox = await thesaurus.boundingBox();
    expect(paneBox).not.toBeNull();
    expect(stripBox).not.toBeNull();
    expect(stripBox!.height).toBeLessThan(paneBox!.height * 0.5);

    // --- Phase 5: switch it back off, and on again ---------------------------
    // Off is a real off in both directions: the setting stops the plugin scanning, and the
    // strip leaves the DOM rather than collapsing to a row of chrome. Nothing but the
    // context menu can bring it back, which is the whole reason the switch lives there.
    await demoRightClick(single.locator('.cm-content'));
    await expect(toggleThesaurus).toHaveText('Disable Thesaurus');
    await demoClick(toggleThesaurus);

    await expect(thesaurus).toHaveCount(0);
    // The editor grew into the space the strip was using.
    const grownPaneBox = await single.boundingBox();
    expect(grownPaneBox).not.toBeNull();
    expect(grownPaneBox!.height).toBeGreaterThan(paneBox!.height);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'thesaurus-turned-off');
    writeNarration(
      screenshotDir,
      step++,
      `"Disable Thesaurus" in the same menu switches it off entirely — the strip disappears and the editor grows back into the space. Nothing is looked up while it's off, and the choice is remembered between sessions.`
    );

    // Back on again. The menu item hands focus back to the editor, and that focus change is
    // itself what re-arms the idle plugin — so the cursor move below is answered normally
    // without the user having to click into the document first.
    await demoRightClick(single.locator('.cm-content'));
    await expect(toggleThesaurus).toHaveText('Enable Thesaurus');
    await demoClick(toggleThesaurus);
    await expect(thesaurus).toBeVisible();

    await mainWindow.keyboard.press('Control+End');
    await expect(synonyms.getByRole('button', { name: 'answer', exact: true })).toBeVisible({ timeout: 15000 });

    // --- Phase 6: click a pill ----------------------------------------------
    // The click has to travel back into the CodeMirror instance the pills came from, which
    // is the one direction the store channel does not run — so nothing but an end-to-end
    // test covers it. The cursor is at the end of the document (Control+End, above), inside
    // "replied", so "answer" lands just past that word rather than replacing it.
    await demoClick(synonyms.getByRole('button', { name: 'answer', exact: true }));

    const editorText = single.locator('.cm-content');
    await expect(editorText).toContainText('the witness replied answer');

    await takeScreenshot(mainWindow, single, screenshotDir, step++, 'synonym-inserted');
    writeNarration(
      screenshotDir,
      step++,
      `Clicking a pill drops that word into the document, right after the word we looked up. It doesn't replace anything — both words are left on the page, and you delete whichever one you don't want. A mis-click can never cost you text.`
    );

    // Undo, so the edit is unmodified again and the Escape below cancels it. (An entry with
    // unsaved changes deliberately ignores Escape, which would strand the next phase.) This
    // doubles as a check that the insertion is an ordinary undoable edit and not something
    // spliced in behind CodeMirror's history.
    await mainWindow.keyboard.press('Control+z');
    await expect(editorText).not.toContainText('answer');

    // --- Phase 7: end the edit ----------------------------------------------
    // Escape cancels an unmodified edit, which unmounts the editor — and with it the strip.
    await mainWindow.keyboard.press('Escape');
    await expect(mainWindow.getByTestId('thesaurus-view')).toHaveCount(0, { timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'edit-ended-no-thesaurus');
    writeNarration(
      screenshotDir,
      step++,
      `Close the editor and the thesaurus goes with it, leaving the file exactly as it was.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
