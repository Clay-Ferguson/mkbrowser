import * as fs from 'fs';
import * as path from 'path';
import { test as baseTest, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demonstrateClickForDemo, insertTextForDemo, logScreenshotSummary, cleanupScreenshots, findActionBarByFileName } from './helpers/mediaUtils';

const federalistPath = '/home/clay/ferguson/projects/mkbrowser/mkbrowser-test/federalist-papers';
const indexYamlPath = `${federalistPath}/.INDEX.yaml`;
const aboutFederalistPath = `${federalistPath}/about-federalist-papers.md`;

// Start the app browsing directly into the federalist-papers folder
const test = baseTest.extend({
  // eslint-disable-next-line no-empty-pattern
  testDataPath: async ({}, use) => {
    await use(federalistPath);
  },
});

test.describe('Document Mode Demo', () => {
  test('demonstrate enabling document mode', async ({ mainWindow }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);

    // Delete any existing .INDEX.yaml so the folder starts in non-document mode
    if (fs.existsSync(indexYamlPath)) {
      fs.unlinkSync(indexYamlPath);
    }
    if (fs.existsSync(aboutFederalistPath)) {
      fs.unlinkSync(aboutFederalistPath);
    }

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // Guard: confirm we landed in the right folder before proceeding
    await expect(mainWindow.getByText('The Federalist Papers')).toBeVisible({ timeout: 10000 });

    // Verify the sort button is visible (confirms we are in non-document mode)
    const sortMenuButton = mainWindow.getByTestId('sort-menu-button');
    await expect(sortMenuButton).toBeVisible({ timeout: 10000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'initial-view');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser. In this demo we will be exploring the Document Mode feature using a folder that contains part of the Federalist Papers — a collection of historical political essays. You can see the folder contents listed here, with each file and subfolder representing a section of the document.`
    );

    // Highlight the sort menu button and explain what it does
    await takeScreenshot(mainWindow, sortMenuButton, screenshotDir, step++, 'sort-menu-button-highlighted');
    writeNarration(
      screenshotDir,
      step++,
      `At the top of the content area you can see the sort button. Normally this menu lets you choose how the folder entries are ordered — by filename, creation time, or modification time. But it also gives us access to a more powerful option: enabling Document Mode. Let's click it to open the menu.`
    );

    await demonstrateClickForDemo(sortMenuButton);

    // Wait for the menu to appear, then highlight "Enable Document Mode"
    const enableDocumentModeItem = mainWindow.getByText('Enable Document Mode');
    await expect(enableDocumentModeItem).toBeVisible({ timeout: 5000 });

    await takeScreenshot(mainWindow, enableDocumentModeItem, screenshotDir, step++, 'enable-document-mode-highlighted');
    writeNarration(
      screenshotDir,
      step++,
      `The sort menu is open. At the bottom of the menu you can see the "Enable Document Mode" option. Clicking this will switch this folder into Document Mode, giving us full control over the order in which entries appear. Let's click it now.`
    );

    await demonstrateClickForDemo(enableDocumentModeItem);

    await mainWindow.waitForTimeout(1000);
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'document-mode-enabled');
    writeNarration(
      screenshotDir,
      step++,
      `Document Mode is now enabled for this folder. Notice that the sort button has disappeared from the toolbar — that's because in Document Mode the order of entries is fixed and controlled by you, not by any automatic sort. MkBrowser has created a hidden file called dot-INDEX-dot-yaml in the folder to record and maintain the entry order. There is more to explore about what Document Mode can do, and we will continue in just a moment.`
    );

    // --- Phase 2: Enable Edit Mode and demonstrate move operations ---

    // Find and highlight the Edit Mode checkbox
    const editCheckbox = mainWindow.getByTestId('doc-mode-edit-checkbox');
    await expect(editCheckbox).toBeVisible({ timeout: 5000 });

    await takeScreenshot(mainWindow, editCheckbox, screenshotDir, step++, 'edit-checkbox-highlighted');
    writeNarration(
      screenshotDir,
      step++,
      `Now that Document Mode is active you can see an "Edit" checkbox in the toolbar at the top right. We are going to click this checkbox to turn on Edit Mode for this document, which will unlock additional controls for managing the order and structure of files.`
    );

    await demonstrateClickForDemo(editCheckbox);
    await mainWindow.waitForTimeout(1000);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'edit-mode-enabled');
    writeNarration(
      screenshotDir,
      step++,
      `Edit Mode is now enabled. You can see that "Insert File" and "Insert Folder" buttons have appeared throughout the document, positioned between entries so you can add new content at any specific location in the document order.`
    );

    // Hover over federalist-00.md to reveal its action bar
    const federalist00Entry = mainWindow
      .getByTestId('browser-entry-markdown')
      .filter({ has: mainWindow.locator('text="federalist-00.md"') })
      .first();
    await federalist00Entry.hover();
    await mainWindow.waitForTimeout(500);

    // Find the Move Down button using the same technique as the reveal button pattern
    const actionBar00 = findActionBarByFileName(mainWindow, 'federalist-00.md');
    const moveDownButton = actionBar00.getByTestId('entry-move-down-button');

    await takeScreenshot(mainWindow, moveDownButton, screenshotDir, step++, 'move-down-button-highlighted');
    writeNarration(
      screenshotDir,
      step++,
      `Hovering over a file header reveals a row of action icons on the right-hand side. Here we can see the "Move Down" arrow button highlighted for the file "federalist-00.md". We are about to click it to move this file down one position in the document order.`
    );

    await demonstrateClickForDemo(moveDownButton, { force: true });
    await mainWindow.waitForTimeout(1000);

    const federalist00EntryMoved = mainWindow
      .getByTestId('browser-entry-markdown')
      .filter({ has: mainWindow.locator('text="federalist-00.md"') })
      .first();

    await takeScreenshot(mainWindow, federalist00EntryMoved, screenshotDir, step++, 'file-moved-down');
    writeNarration(
      screenshotDir,
      step++,
      `We can now see that "federalist-00.md" has been moved down one position in the document. The file order in Document Mode is entirely under your control — just click the arrow buttons to reposition any file.`
    );

    // Hover again to reveal action buttons for the move-up operation
    await federalist00EntryMoved.hover();
    await mainWindow.waitForTimeout(500);

    const actionBar00Again = findActionBarByFileName(mainWindow, 'federalist-00.md');
    const moveUpButton = actionBar00Again.getByTestId('entry-move-up-button');

    await takeScreenshot(mainWindow, moveUpButton, screenshotDir, step++, 'move-up-button-highlighted');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's move it back up to where it was. We can see the "Move Up" arrow button highlighted in the action bar. We are going to click it to restore the file to its original position at the top of the list.`
    );

    await demonstrateClickForDemo(moveUpButton, { force: true });
    await mainWindow.waitForTimeout(1000);

    const federalist00EntryRestored = mainWindow
      .getByTestId('browser-entry-markdown')
      .filter({ has: mainWindow.locator('text="federalist-00.md"') })
      .first();

    await takeScreenshot(mainWindow, federalist00EntryRestored, screenshotDir, step++, 'file-moved-back-up');
    writeNarration(
      screenshotDir,
      step++,
      `And there we have it — "federalist-00.md" is back at the top where it started. Document Mode gives you full, intuitive control over how your documents are ordered. There is more to explore, and we will continue in just a moment.`
    );

    // --- Phase 3: Insert a new file at a specific location ---

    // Find the second "Insert File" button (nth(1) = second instance)
    const insertFileButtons = mainWindow.getByTestId('insert-file-here');
    const secondInsertFileButton = insertFileButtons.nth(1);
    await expect(secondInsertFileButton).toBeVisible({ timeout: 5000 });

    await takeScreenshot(mainWindow, secondInsertFileButton, screenshotDir, step++, 'insert-file-button-highlighted');
    writeNarration(
      screenshotDir,
      step++,
      `You can see the "Insert File" buttons scattered throughout the document — one between each entry. We are going to use the second one to insert a brand new file right here at this specific position in the document. Let's click it to open the Create File dialog.`
    );

    await demonstrateClickForDemo(secondInsertFileButton);

    // Wait for the create file dialog to appear
    const filenameInput = mainWindow.getByTestId('create-file-dialog-input');
    await expect(filenameInput).toBeVisible({ timeout: 5000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'create-dialog-open');
    writeNarration(
      screenshotDir,
      step++,
      `The Create File dialog has appeared. We will type the name for our new file now.`
    );

    await insertTextForDemo(mainWindow, 'about-federalist-papers', true, filenameInput);

    await takeScreenshot(mainWindow, filenameInput, screenshotDir, step++, 'filename-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We have entered "about-federalist-papers" as the filename. MkBrowser will automatically append the ".md" extension, making this a Markdown document. Now let's click Create to create the file.`
    );

    const createDialogButton = mainWindow.getByTestId('create-file-dialog-create-button');
    await takeScreenshot(mainWindow, createDialogButton, screenshotDir, step++, 'about-to-create-file');
    writeNarration(
      screenshotDir,
      step++,
      `We are about to click the Create button to confirm. Once created, the file will open directly in the editor so we can add content right away.`
    );

    await demonstrateClickForDemo(createDialogButton);
    await mainWindow.waitForTimeout(1000);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'file-editor-open');
    writeNarration(
      screenshotDir,
      step++,
      `The new file has been created and the editor is now open. Notice it was inserted exactly at the position we chose. Let's type some introductory content for this file.`
    );

    await insertTextForDemo(mainWindow, `The Federalist Papers are a collection of 85 articles and essays written between 1787 and 1788 to promote the ratification of the United States Constitution. Authored by Alexander Hamilton, James Madison, and John Jay under the collective pseudonym "Publius," these documents served as a masterclass in political advocacy and constitutional theory. They were originally published in New York newspapers to convince skeptical citizens that a stronger central government was necessary to preserve the Union. Even today, the papers remain one of the most important sources for interpreting the original intent of the Framers and understanding the underlying logic of the American governing system. Because of their profound impact on legal and political thought, they are widely considered the most significant contribution to political science ever produced in the United States.
      `, true);

    const cmEditor = mainWindow.locator('.cm-editor').first();
    await takeScreenshot(mainWindow, cmEditor, screenshotDir, step++, 'content-typed');
    writeNarration(
      screenshotDir,
      step++,
      `We have entered our content into the editor. In the final version of this demo the text will be something like: "The Federalist Papers are a collection of 85 articles written by Alexander Hamilton, James Madison, and John Jay under the pseudonym 'Publius'. Published between 1787 and 1788 to persuade New York citizens to ratify the proposed United States Constitution, they remain one of the most important sources for understanding the original intent of the Founders." Now let's save the file.`
    );

    const saveButton = mainWindow.getByTestId('entry-save-button');
    await takeScreenshot(mainWindow, saveButton, screenshotDir, step++, 'about-to-save');
    writeNarration(
      screenshotDir,
      step++,
      `The Save button is ready. Let's click it to write our content to disk and close the editor.`
    );

    await demonstrateClickForDemo(saveButton);
    await mainWindow.waitForTimeout(1000);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'file-saved');
    writeNarration(
      screenshotDir,
      step++,
      `The file has been saved and is now part of the document at exactly the position we specified. That brings us to the end of this Document Mode demo. We have seen how to enable Document Mode, turn on Edit Mode, reorder files with the move buttons, and insert brand new files at precise locations within the document. Document Mode in MkBrowser gives you full editorial control over the structure and order of your content — making it an ideal tool for managing long-form documents, reference collections, or any set of Markdown files where order matters.`
    );

    logScreenshotSummary(screenshotDir);
  });
});
