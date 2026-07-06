import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import {
  takeScreenshot,
  writeNarration,
  demoClick,
  setCheckbox,
  logScreenshotSummary,
  cleanupScreenshots,
  cleanupTestDataFiles,
  resetSettings,
} from './helpers/mediaUtils';

/**
 * E2E Demo Test: Split and Join
 *
 * Demonstrates the Split and Join items in the Edit popup menu:
 *   1. Seeds a subfolder containing a single markdown file with three
 *      paragraphs separated by double blank lines (the split delimiter).
 *   2. Selects the file and uses Edit menu > Split, producing three numbered
 *      files (-00, -01, -02), one paragraph each.
 *   3. Selects all three files with their checkboxes and uses Edit menu > Join,
 *      merging them back into the alphabetically-first file (-00) and deleting
 *      the others.
 *
 * The demo runs inside its own subfolder so only these files are on screen.
 */

// Opening paragraphs of Moby-Dick (public domain). Separated by double blank
// lines when written to disk — that's the delimiter Split looks for.
const paragraphs = [
  `Call me Ishmael. Some years ago — never mind how long precisely — having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen and regulating the circulation.`,
  `There now is your insular city of the Manhattoes, belted round by wharves as Indian isles by coral reefs — commerce surrounds it with her surf. Right and left, the streets take you waterward. Its extreme downtown is the battery, where that noble mole is washed by waves, and cooled by breezes, which a few hours previous were out of sight of land.`,
  `Circumambulate the city of a dreamy Sabbath afternoon. Go from Corlears Hook to Coenties Slip, and from thence, by Whitehall, northward. What do you see? Posted like silent sentinels all around the town, stand thousands upon thousands of mortal men fixed in ocean reveries.`,
];

// Short, distinctive snippets used to assert each paragraph's presence on screen.
const snippets = [
  'Call me Ishmael',
  'insular city of the Manhattoes',
  'Circumambulate the city',
];

test.describe('Split and Join Demo', () => {
  test('split a file into paragraphs and join them back together', async ({ mainWindow, testDataPath }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // Seed a dedicated subfolder with a single three-paragraph file.
    // cleanupTestDataFiles() removes my-*.md files recursively but not the
    // folder itself, so remove and recreate it here for a clean slate.
    const demoFolderName = 'my-split-join';
    const demoFolderPath = path.join(testDataPath, demoFolderName);
    fs.rmSync(demoFolderPath, { recursive: true, force: true });
    fs.mkdirSync(demoFolderPath);

    const sourceFileName = 'my-novel-excerpt.md';
    const splitFileNames = ['my-novel-excerpt-00.md', 'my-novel-excerpt-01.md', 'my-novel-excerpt-02.md'];
    fs.writeFileSync(path.join(demoFolderPath, sourceFileName), paragraphs.join('\n\n\n') + '\n');

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // The folder was written to disk after the app started reading the
    // directory, so refresh to make sure it shows up.
    await demoClick(mainWindow.getByTestId('refresh-button'));

    const mainContent = mainWindow.getByTestId('browser-main-content');
    await expect(mainContent.getByText(demoFolderName, { exact: true })).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser.
Today we're going to look at the Split and Join features, which let you break a document apart into separate files, and put it back together again.
We'll start by opening this folder, which contains a single markdown file.`
    );

    // Navigate into the demo folder.
    await demoClick(mainContent.getByText(demoFolderName, { exact: true }));

    await expect(mainContent.getByText(sourceFileName).first()).toBeVisible({ timeout: 10000 });
    for (const snippet of snippets) {
      await expect(mainContent.getByText(snippet).first()).toBeVisible();
    }

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'single-file-three-paragraphs');
    writeNarration(
      screenshotDir,
      step++,
      `Here is our file. It contains the three opening paragraphs of Moby Dick, with each paragraph separated from the next by a double blank line.
That double blank line is important, because it's exactly what the Split feature uses as its dividing point.`
    );

    // Select the file — Split requires exactly one selected file.
    const sourceCheckbox = mainContent.getByRole('checkbox', { name: `Select ${sourceFileName}` });
    await setCheckbox(sourceCheckbox, true);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'file-selected-for-split');
    writeNarration(
      screenshotDir,
      step++,
      `We've selected the file using its checkbox.
Now let's open the Edit menu, where the Split option lives.`
    );

    // Open the Edit menu and click Split.
    const editMenuButton = mainWindow.getByTestId('edit-menu-button');
    await takeScreenshot(mainWindow, editMenuButton, screenshotDir, step++, 'about-to-open-edit-menu');
    writeNarration(
      screenshotDir,
      step++,
      `We click the Edit menu button in the toolbar.`
    );

    await demoClick(editMenuButton);

    const splitMenuItem = mainWindow.getByRole('button', { name: 'Split', exact: true });
    await expect(splitMenuItem).toBeVisible();
    await takeScreenshot(mainWindow, splitMenuItem, screenshotDir, step++, 'about-to-click-split');
    writeNarration(
      screenshotDir,
      step++,
      `The Edit menu is open, and we can see both the Split and Join options.
We'll click Split, which divides the selected file at every double blank line.`
    );

    await demoClick(splitMenuItem);

    // The split produces three numbered files; the original name is gone.
    for (const file of splitFileNames) {
      await expect(mainContent.getByText(file).first()).toBeVisible({ timeout: 10000 });
    }
    await expect(mainContent.getByText(sourceFileName, { exact: true })).toHaveCount(0);

    // Verify on disk: the original was replaced by three numbered parts, each
    // holding its own paragraph.
    await expect(async () => {
      expect(fs.existsSync(path.join(demoFolderPath, sourceFileName))).toBe(false);
      splitFileNames.forEach((file, i) => {
        const content = fs.readFileSync(path.join(demoFolderPath, file), 'utf-8');
        expect(content).toContain(snippets[i]);
      });
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'file-split-into-three');
    writeNarration(
      screenshotDir,
      step++,
      `And just like that, our single document has become three separate files, each containing one paragraph.
Notice the naming: the original file was renamed with a dash zero zero suffix, and the other paragraphs became dash zero one and dash zero two.
This numbering keeps the pieces in their original order.`
    );

    // Select all three files with their checkboxes — Join needs two or more.
    for (const file of splitFileNames) {
      const checkbox = mainContent.getByRole('checkbox', { name: `Select ${file}` });
      await setCheckbox(checkbox, true);
    }

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'three-files-selected-for-join');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's reverse the operation.
We've checked the checkboxes on all three files, and we'll head back into the Edit menu to join them.`
    );

    await takeScreenshot(mainWindow, editMenuButton, screenshotDir, step++, 'about-to-open-edit-menu-again');
    writeNarration(
      screenshotDir,
      step++,
      `We open the Edit menu again.`
    );

    await demoClick(editMenuButton);

    const joinMenuItem = mainWindow.getByRole('button', { name: 'Join', exact: true });
    await expect(joinMenuItem).toBeVisible();
    await takeScreenshot(mainWindow, joinMenuItem, screenshotDir, step++, 'about-to-click-join');
    writeNarration(
      screenshotDir,
      step++,
      `This time we click Join.
Join sorts the selected files alphabetically, merges their contents into the first one with double blank lines between the parts, and removes the leftover files.`
    );

    await demoClick(joinMenuItem);

    // The join merges everything into the alphabetically-first file (-00) and
    // deletes the other two.
    const joinedFileName = splitFileNames[0]!;
    await expect(mainContent.getByText(joinedFileName).first()).toBeVisible({ timeout: 10000 });
    for (const file of splitFileNames.slice(1)) {
      await expect(mainContent.getByText(file)).toHaveCount(0, { timeout: 10000 });
    }
    // All three paragraphs are rendered together again in the one file.
    for (const snippet of snippets) {
      await expect(mainContent.getByText(snippet).first()).toBeVisible();
    }

    // Verify on disk: one file containing all three paragraphs, the rest gone.
    await expect(async () => {
      const content = fs.readFileSync(path.join(demoFolderPath, joinedFileName), 'utf-8');
      for (const snippet of snippets) {
        expect(content).toContain(snippet);
      }
      for (const file of splitFileNames.slice(1)) {
        expect(fs.existsSync(path.join(demoFolderPath, file))).toBe(false);
      }
    }).toPass({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'files-joined-back-together');
    writeNarration(
      screenshotDir,
      step++,
      `The three files have been merged back into a single document containing all three paragraphs, in the right order.
Split and Join are perfect companions: split a large document to work on its sections independently, then join the pieces back together when you're done.`
    );

    // Cleanup: remove the joined file so the demo folder is left empty and
    // nothing this test created lingers in other demos.
    fs.unlinkSync(path.join(demoFolderPath, joinedFileName));

    logScreenshotSummary(screenshotDir);
  });
});
