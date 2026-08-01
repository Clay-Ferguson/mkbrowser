import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot,
  writeNarration,
  demoClick,
  logScreenshotSummary,
  cleanupScreenshots,
  cleanupTestDataFiles,
  resetSettings,
} from './helpers/mediaUtils';

/**
 * Private E2E Test: Thesaurus strip
 *
 * While a file is open for editing in single-file mode, a strip below the editor shows
 * synonyms for the word under the cursor — with no gesture from the user beyond parking
 * the cursor there for a moment.
 *
 * Almost none of that is checkable by unit tests: the word travels from a CodeMirror view
 * plugin, through the store, into a component that looks it up over IPC, in a process that
 * has to find a ~2 MB data file shipped in `resources/`. This test is the only thing that
 * exercises the whole chain, so it covers:
 *
 *   1. The strip appears only while editing — absent when merely browsing the file.
 *   2. Parking the cursor on a word produces that word's synonyms, unprompted — including
 *      for an inflected word, which is answered from its base form.
 *   3. Moving the cursor to a different word replaces them. This is the assertion that
 *      matters most: a strip that shows the first word forever would pass a weaker test.
 *   4. Ending the edit takes the strip away again.
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

    // --- Phase 2: start editing --------------------------------------------
    await demoClick(single.locator('.cm-content'));
    await expect(mainWindow.getByTestId('entry-save-button')).toBeVisible({ timeout: 10000 });

    // The strip is there the moment editing starts, telling the user what to do rather
    // than sitting blank and unexplained.
    const thesaurus = mainWindow.getByTestId('thesaurus-view');
    await expect(thesaurus).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, thesaurus, screenshotDir, step++, 'editing-thesaurus-idle');
    writeNarration(
      screenshotDir,
      step++,
      `Opening the editor brings up a slim strip along the bottom. It's the thesaurus, waiting for us to put the cursor on a word.`
    );

    // --- Phase 3: park the cursor on an inflected word ----------------------
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

    // The editor still owns the screen: the strip is meant to be unobtrusive, roughly three
    // rows of pills. If its height ever ran away, this is what would catch it.
    const paneBox = await single.boundingBox();
    const stripBox = await thesaurus.boundingBox();
    expect(paneBox).not.toBeNull();
    expect(stripBox).not.toBeNull();
    expect(stripBox!.height).toBeLessThan(paneBox!.height * 0.35);

    // --- Phase 5: end the edit ----------------------------------------------
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
