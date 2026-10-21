import * as fs from 'fs';
import * as path from 'path';
import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demoClick, demoRightClick, insertText, activeView, logScreenshotSummary, cleanupScreenshots, cleanupTestDataFiles, resetSettings } from './helpers/mediaUtils';

/**
 * E2E Demo Test — Custom Data Types (Objects)
 *
 * Demonstrates defining a custom object type and using it in a document:
 *   1. Open the System Menu and choose "Types" to open the Types Editor.
 *   2. Add a "contact" type with a description and six properties
 *      (name, birthday, cell_phone, email, address, website), then Save.
 *   3. Back in the Browse view, create a new Markdown file (light narration —
 *      other demos already cover file creation).
 *   4. Right-click in the editor and choose Insert Object ▸ Contact, then fill
 *      in each property's value in the front matter YAML.
 *   5. Save the file and show the rendered object card.
 *   6. Run an Advanced search for `p.type=='contact'`, saved as "Contacts",
 *      and show the Search Results listing the one contact.
 *
 * The seed config defines no types, so the "contact" name is always free, and
 * the type lives only in the test's throwaway user-data dir.
 */

// Property definitions entered in the Types Editor, in card order (the first is the card's title).
const PROPERTIES = [
  {
    name: 'name',
    description: 'Full name',
    type: 'text',
    narration: `Our first property is "name", described as "Full name", with the default type of Text.
The first property is special: its value becomes the bold title of the card.`,
  },
  {
    name: 'birthday',
    description: 'Date of birth',
    type: 'date',
    narration: `Next is "birthday", with the type set to Date.
A date is shown on the card along with how long ago, or how far away, it is.`,
  },
  {
    name: 'cell_phone',
    description: 'Mobile number',
    type: 'phone',
    narration: `Then "cell_phone", with the type set to Phone, so the number becomes a link that dials it.`,
  },
  {
    name: 'email',
    description: 'Email address',
    type: 'email',
    narration: `Then "email", with the type set to Email, so clicking it starts a new message.`,
  },
  {
    name: 'address',
    description: 'Mailing address',
    type: 'address',
    narration: `Then "address", with the type set to Address, so clicking it opens a map.`,
  },
  {
    name: 'website',
    description: 'Personal website',
    type: 'url',
    narration: `And finally "website", with the type set to URL, so clicking it opens the page in your web browser.`,
  },
];

// Values typed into the inserted front matter, one line each, in the same order as PROPERTIES.
const VALUES = [
  {
    line: 'name: Clay Ferguson',
    narration: `The cursor is already waiting on the name line, so we'll type the contact's name.`,
  },
  {
    line: 'birthday: 1980-05-12',
    narration: `Next we replace today's date with the contact's real birthday.`,
  },
  {
    line: 'cell_phone: 555-123-4567',
    narration: `Then we'll enter the contact's cell phone number.`,
  },
  {
    line: 'email: clay@example.com',
    narration: `Next comes the contact's email address.`,
  },
  {
    line: 'address: 1 Main St, Dallas, TX 75001',
    narration: `Then we'll enter the contact's mailing address.`,
  },
  {
    line: 'website: https://clay-ferguson.github.io',
    narration: `And finally, we'll enter the address of the contact's website.`,
  },
];

/**
 * Scrolls the Types Editor's property list (the nearest scrollable ancestor of
 * `el`) all the way down, so the last-added property row is fully visible once
 * the list outgrows the pane. Done in code rather than with a mouse gesture.
 */
async function scrollPropertyListToBottom(el: Locator): Promise<void> {
  await el.evaluate((node) => {
    const list = node.closest('.overflow-y-auto');
    if (list) list.scrollTop = list.scrollHeight;
  });
}

test.describe('Custom Data Types Demo', () => {
  test('define a custom type and insert it into a file', async ({ mainWindow, testDataPath }) => {
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

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
      `Welcome to this MkBrowser feature demo.
In this demo we'll look at custom data types, which let you turn a Markdown note into a structured record, like a contact, a book, or a piece of equipment.
We'll define our own "contact" type, and then use it to create a contact card inside a note.`
    );

    // ── 2. Open the System popup menu ─────────────────────────────────
    const systemMenuButton = mainWindow.getByTestId('system-menu-button');
    await expect(systemMenuButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, systemMenuButton, screenshotDir, step++, 'highlight-system-menu');
    writeNarration(
      screenshotDir,
      step++,
      `Types are defined in the Types Editor, which we open from the System Menu in the top right corner.`
    );

    await demoClick(systemMenuButton);

    // ── 3. Click the "Types" menu item ────────────────────────────────
    const typesMenuItem = mainWindow.getByTestId('menu-types-editor');
    await expect(typesMenuItem).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, typesMenuItem, screenshotDir, step++, 'highlight-types-menu-item');
    writeNarration(
      screenshotDir,
      step++,
      `Let's click "Types" to open the Types Editor.`
    );

    await demoClick(typesMenuItem);

    // ── 4. The (empty) Types Editor ───────────────────────────────────
    const typesView = mainWindow.getByTestId('view-types-editor');
    await expect(typesView).toHaveAttribute('data-active-view', 'true', { timeout: 5000 });
    await expect(typesView.getByText('Add a type to get started.')).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'types-editor-open');
    writeNarration(
      screenshotDir,
      step++,
      `The Types Editor opens in its own tab.
On the left is the list of object types, and on the right are the properties of the selected type.
Nothing is built in, so the list starts out empty.`
    );

    // ── 5. Add the "contact" type ─────────────────────────────────────
    const addTypeButton = mainWindow.getByTestId('types-editor-add-type-button');
    await takeScreenshot(mainWindow, addTypeButton, screenshotDir, step++, 'highlight-add-type');
    writeNarration(
      screenshotDir,
      step++,
      `We'll click the plus button next to the "Object Types" heading to add a new type.`
    );

    await demoClick(addTypeButton);

    const renameInput = mainWindow.getByTestId('types-editor-type-rename-input');
    await expect(renameInput).toBeVisible({ timeout: 5000 });
    await insertText(mainWindow, 'contact', true, renameInput);

    await takeScreenshot(mainWindow, renameInput, screenshotDir, step++, 'type-name-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We've named the type "contact".
Type names can use letters, digits, and underscores.
Pressing Enter saves the new type.`
    );

    await renameInput.press('Enter');
    const contactRow = typesView.locator('[data-testid^="types-editor-type-select-button-"]', { hasText: 'contact' });
    await expect(contactRow).toBeVisible({ timeout: 5000 });

    // ── 6. Type description ───────────────────────────────────────────
    const descriptionInput = mainWindow.getByTestId('types-editor-type-description-input');
    await expect(descriptionInput).toBeVisible({ timeout: 5000 });
    await insertText(mainWindow, 'Contact', true, descriptionInput);

    await takeScreenshot(mainWindow, descriptionInput, screenshotDir, step++, 'type-description-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We'll give the type a description of "Contact".
This description is the name we'll see for this type in the editor's Insert Object menu.`
    );

    // ── 7. Add the properties ─────────────────────────────────────────
    const addPropertyButton = mainWindow.getByTestId('types-editor-add-property-button');
    await takeScreenshot(mainWindow, addPropertyButton, screenshotDir, step++, 'highlight-add-property');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's add the properties that every contact will hold.
Each click of this plus button adds a property, with a name, a short description, and a type that controls how its value is displayed.`
    );

    // New properties are appended, so the last row's inputs are always the one just added.
    const propertyNameInputs = typesView.locator('[data-testid^="types-editor-property-name-input-"]');
    const propertyDescriptionInputs = typesView.locator('[data-testid^="types-editor-property-description-input-"]');
    const propertyTypeSelects = typesView.locator('[data-testid^="types-editor-property-type-select-"]');

    for (const [index, prop] of PROPERTIES.entries()) {
      await demoClick(addPropertyButton);
      await expect(propertyNameInputs).toHaveCount(index + 1, { timeout: 5000 });
      await scrollPropertyListToBottom(propertyNameInputs.last());

      await insertText(mainWindow, prop.name, true, propertyNameInputs.last());
      await insertText(mainWindow, prop.description, true, propertyDescriptionInputs.last());

      const typeSelect = propertyTypeSelects.last();
      await typeSelect.selectOption(prop.type);
      await scrollPropertyListToBottom(typeSelect);
      await mainWindow.waitForTimeout(500);

      await takeScreenshot(mainWindow, typeSelect, screenshotDir, step++, `property-${prop.name}-added`);
      writeNarration(screenshotDir, step++, prop.narration);
    }

    // ── 8. Save the types ─────────────────────────────────────────────
    await expect(mainWindow.getByTestId('types-editor-dirty')).toBeVisible({ timeout: 5000 });
    const saveTypesButton = mainWindow.getByTestId('types-editor-save-button');
    await takeScreenshot(mainWindow, saveTypesButton, screenshotDir, step++, 'highlight-save-types');
    writeNarration(
      screenshotDir,
      step++,
      `Notice the "Unsaved changes" note at the bottom.
Let's click "Save" to store our new type.`
    );

    await demoClick(saveTypesButton);

    await expect(mainWindow.getByTestId('types-editor-dirty')).not.toBeVisible({ timeout: 5000 });
    await expect(saveTypesButton).toBeDisabled();
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'types-saved');
    writeNarration(
      screenshotDir,
      step++,
      `Our contact type is saved, and it takes effect immediately, with no restart needed.
Now let's put it to use in a note.`
    );

    // ── 9. Back to the Browse view ────────────────────────────────────
    const browseTab = mainWindow.getByTestId('app-tab-buttons').getByTestId('tab-button-browser');
    await expect(browseTab).toBeVisible({ timeout: 5000 });
    await demoClick(browseTab);
    await mainWindow.waitForTimeout(500);

    // ── 10. Create a new file (light narration — covered by other demos) ──
    const createButton = mainWindow.getByTestId('create-file-button');
    await expect(createButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, createButton, screenshotDir, step++, 'highlight-create-file');
    writeNarration(
      screenshotDir,
      step++,
      `Back in the Browse view, we'll quickly create a new Markdown file named "my-contact" to hold our contact.`
    );

    await demoClick(createButton);

    const filenameInput = mainWindow.getByTestId('create-file-dialog-input');
    await expect(filenameInput).toBeVisible({ timeout: 5000 });
    await insertText(mainWindow, 'my-contact', true, filenameInput);
    await takeScreenshot(mainWindow, filenameInput, screenshotDir, step++, 'filename-entered');

    await demoClick(mainWindow.getByTestId('create-file-dialog-create-button'));
    await mainWindow.waitForTimeout(1000);

    // ── 11. Insert Object ▸ Contact from the editor context menu ─────
    const cmEditor = mainWindow.locator('.cm-editor').first();
    await expect(cmEditor).toBeVisible({ timeout: 10000 });
    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'new-file-editor-open');
    writeNarration(
      screenshotDir,
      step++,
      `The new file is open in the editor.
Rather than typing the contact's properties by hand, we'll right-click inside the editor and let MkBrowser insert them for us.`
    );

    await demoRightClick(mainWindow.locator('.cm-content').first());

    const insertObjectItem = mainWindow.getByTestId('editor-insert-object');
    await expect(insertObjectItem).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, insertObjectItem, screenshotDir, step++, 'highlight-insert-object');
    writeNarration(
      screenshotDir,
      step++,
      `The editor's context menu now includes an "Insert Object" item, since we have at least one type defined.
Let's click it to see our types.`
    );

    await demoClick(insertObjectItem);

    const insertContactItem = mainWindow.getByTestId('editor-insert-object-contact');
    await expect(insertContactItem).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, insertContactItem, screenshotDir, step++, 'highlight-insert-contact');
    writeNarration(
      screenshotDir,
      step++,
      `The menu now lists our types by their descriptions.
We'll choose "Contact" to insert a new contact.`
    );

    await demoClick(insertContactItem);

    // ── 12. The inserted front matter ─────────────────────────────────
    await expect(mainWindow.locator('.cm-content').first()).toContainText('type: contact', { timeout: 5000 });
    await takeScreenshot(mainWindow, cmEditor, screenshotDir, step++, 'object-inserted');
    writeNarration(
      screenshotDir,
      step++,
      `MkBrowser has added the contact to the file's front matter, the [YAML](/jˈæməl/) block at the very top of the file.
There's a "type" line naming the type, followed by each of its properties in the order we defined them.
The birthday starts out as today's date, and the other values are empty, ready for us to fill in.`
    );

    // ── 13. Fill in the property values ───────────────────────────────
    // The cursor starts at the end of the `name:` line. Each value rewrites its
    // whole line (Home, Shift+End, insert), which also replaces the pre-filled date.
    for (const [index, value] of VALUES.entries()) {
      if (index > 0) await mainWindow.keyboard.press('ArrowDown');
      await mainWindow.keyboard.press('Home');
      await mainWindow.keyboard.press('Shift+End');
      await insertText(mainWindow, value.line, true);

      await takeScreenshot(mainWindow, cmEditor, screenshotDir, step++, `value-${PROPERTIES[index]!.name}-entered`);
      writeNarration(screenshotDir, step++, value.narration);
    }

    await mainWindow.keyboard.press('Control+End');
    await insertText(mainWindow, 'Met at the 2024 conference. Prefers email.', true);

    await takeScreenshot(mainWindow, cmEditor, screenshotDir, step++, 'body-entered');
    writeNarration(
      screenshotDir,
      step++,
      `Below the front matter, the rest of the note is free-form, so we've added a short note about this contact.`
    );

    // ── 14. Save the file ─────────────────────────────────────────────
    const saveButton = mainWindow.getByTestId('entry-save-button');
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, saveButton, screenshotDir, step++, 'highlight-save-file');
    writeNarration(
      screenshotDir,
      step++,
      `Let's click "Save" to write the file to disk.`
    );

    await demoClick(saveButton);
    await expect(mainWindow.getByTestId('entry-save-button')).not.toBeVisible({ timeout: 5000 });
    await mainWindow.waitForTimeout(500);

    // ── 15. The rendered object card ──────────────────────────────────
    const contactCard = activeView(mainWindow).locator('[data-testid="object-block"][data-object-type="contact"]');
    await expect(contactCard).toBeVisible({ timeout: 10000 });
    await expect(contactCard).toContainText('Clay Ferguson');
    await contactCard.scrollIntoViewIfNeeded();
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, contactCard, screenshotDir, step++, 'contact-card-shown');
    writeNarration(
      screenshotDir,
      step++,
      `The file is saved, and instead of raw [YAML](/jˈæməl/) we now see a contact card at the top of the note.
The type name appears in the top right corner, and the name is the card's bold title.
Each other property has its own line with an icon, the phone, email, address, and website are clickable links, and the birthday shows how long ago it was.
Clicking anywhere else on the card opens the editor again.`
    );

    // ── 16. Search for every contact ──────────────────────────────────
    // A search covers the browsed folder and its subfolders; we're still in the
    // root folder that holds my-contact.md, so no navigation is needed.
    const searchMenuButton = mainWindow.getByTestId('search-menu-button');
    await expect(searchMenuButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, searchMenuButton, screenshotDir, step++, 'highlight-search-menu');
    writeNarration(
      screenshotDir,
      step++,
      `Because every contact is marked with its type, we can also search for all of our contacts at once.
Let's click the search icon to open the search menu.`
    );

    await demoClick(searchMenuButton);

    const newSearchItem = mainWindow.getByTestId('menu-new-search');
    await expect(newSearchItem).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, newSearchItem, screenshotDir, step++, 'highlight-new-search');
    writeNarration(
      screenshotDir,
      step++,
      `We'll click "New Search..." to open the search dialog.`
    );

    await demoClick(newSearchItem);

    const advancedOption = mainWindow.getByTestId('search-type-advanced');
    await expect(advancedOption).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, advancedOption, screenshotDir, step++, 'highlight-advanced-mode');
    writeNarration(
      screenshotDir,
      step++,
      `We'll select "Advanced" mode, which lets us search with a JavaScript expression.`
    );

    await demoClick(advancedOption);

    const searchInput = mainWindow.getByTestId('search-query-input');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await insertText(mainWindow, `p.type=='contact'`, true, searchInput);

    await takeScreenshot(mainWindow, searchInput, screenshotDir, step++, 'contact-query-entered');
    writeNarration(
      screenshotDir,
      step++,
      `In an advanced search, a file's front matter properties can always be referenced through a variable named "p".
So the expression p dot type, double-equals, "contact", matches every file whose object is a contact.`
    );

    // Save the query as a named search definition (the ＋ button saves the current search)
    const addSearchButton = mainWindow.getByTestId('search-definition-add-button');
    await expect(addSearchButton).toBeVisible({ timeout: 5000 });
    await demoClick(addSearchButton);

    const searchNameInput = mainWindow.getByTestId('search-definition-name-input');
    await expect(searchNameInput).toBeVisible({ timeout: 5000 });
    await insertText(mainWindow, 'Contacts', true, searchNameInput);

    await takeScreenshot(mainWindow, searchNameInput, screenshotDir, step++, 'search-name-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We'll save this as a search named "Contacts", so we can run it again any time from the search menu.`
    );

    await searchNameInput.press('Enter');
    await expect(mainWindow.getByTestId('search-definition-row-Contacts')).toBeVisible({ timeout: 5000 });
    await expect(mainWindow.getByTestId('search-dialog-editing-label')).toContainText('Contacts');

    const executeSearchButton = mainWindow.getByTestId('execute-search-button');
    await expect(executeSearchButton).toBeEnabled({ timeout: 5000 });
    await takeScreenshot(mainWindow, executeSearchButton, screenshotDir, step++, 'highlight-execute-search');
    writeNarration(
      screenshotDir,
      step++,
      `Now let's click the "Search" button to find our contacts.`
    );

    await demoClick(executeSearchButton);

    // ── 17. The search results: exactly our one contact ───────────────
    const searchResultsView = mainWindow.getByTestId('view-search-results');
    await expect(searchResultsView).toHaveAttribute('data-active-view', 'true', { timeout: 10000 });
    await expect(searchResultsView).toContainText('1 file found', { timeout: 10000 });
    await expect(searchResultsView).toContainText('my-contact.md');
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'search-results-shown');
    writeNarration(
      screenshotDir,
      step++,
      `The search results list exactly one file, our new contact, since it's the only contact we've created so far.
That's all it takes to use custom types. Define a type once in the Types Editor, then insert it into any note to turn it into a structured, easy to read record that you can search for, while your file stays plain, portable Markdown.`
    );

    // ── 18. Disk check: the object was written to the file's front matter ──
    const contactFile = path.join(testDataPath, 'my-contact.md');
    await expect(async () => {
      const content = fs.readFileSync(contactFile, 'utf8');
      expect(content).toContain('type: contact');
      expect(content).toContain('name: Clay Ferguson');
      expect(content).toContain('birthday: 1980-05-12');
      expect(content).toContain('email: clay@example.com');
      expect(content).toContain('website: https://clay-ferguson.github.io');
      expect(content).toContain('Met at the 2024 conference.');
    }).toPass({ timeout: 10000 });

    logScreenshotSummary(screenshotDir);
  });
});
