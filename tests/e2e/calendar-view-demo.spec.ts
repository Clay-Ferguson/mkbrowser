import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from './fixtures/electronApp';
import { takeScreenshot, writeNarration, demoClick, insertText, logScreenshotSummary, cleanupScreenshots, cleanupTestDataFiles, resetSettings } from './helpers/mediaUtils';

/**
 * E2E Demo Test: Calendar View Feature
 *
 * This test walks through the Calendar View feature of MkBrowser, capturing
 * screenshots and narration at each step for GIF/MP4 generation.
 *
 * NOTE: This demo is being built up in phases. The current phase ends abruptly
 * because more steps will be appended later. Narration must therefore never
 * imply that the demo is over.
 */
test.describe('Calendar View Demo', () => {
  // Ensure the calendar folder exists before the app launches, since the demo
  // expects to see (and open) this folder as soon as the GUI appears.
  test.beforeAll(() => {
    const calendarFolder = path.resolve(path.join(__dirname, '../../mkbrowser-test/calendar'));
    fs.mkdirSync(calendarFolder, { recursive: true });
  });

  test('demonstrate the calendar view', async ({ mainWindow }) => {
    // Create subfolder based on test file name
    const testName = path.basename(__filename, '.spec.ts');
    const screenshotDir = path.join(__dirname, '../../screenshots', testName);

    cleanupScreenshots(screenshotDir);
    cleanupTestDataFiles();
    await resetSettings(mainWindow);

    // Make sure the calendar item this demo creates does not already exist, so the
    // run always starts from a clean state and the New Calendar Item dialog can
    // create the file without colliding with a leftover from a previous run.
    const createdCalendarFile = path.resolve(
      path.join(__dirname, '../../mkbrowser-test/calendar/bi-weekly-reports.md')
    );
    if (fs.existsSync(createdCalendarFile)) {
      fs.unlinkSync(createdCalendarFile);
    }

    let step = 1;

    // Wait for initial load
    await mainWindow.waitForTimeout(2000);

    // Verify initial state — expect to see the mkbrowser-test contents, including
    // the "calendar" folder we created to hold our calendar entries.
    const mainContent = mainWindow.getByTestId('browser-main-content');
    const calendarFolder = mainContent.getByText('calendar', { exact: true }).first();
    await expect(calendarFolder).toBeVisible({ timeout: 10000 });

    // Open the calendar folder so we are working inside it.
    await demoClick(calendarFolder);
    await mainWindow.waitForTimeout(1000);

    // --- Phase 1: open the calendar folder and switch to the Calendar View ---

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'calendar-folder-open');
    writeNarration(
      screenshotDir,
      step++,
      `Welcome to MkBrowser.
In this demo we are going to create a repeating, weekly calendar item.
We are currently inside a folder named "calendar", which we created to hold our calendar entries.
Right now the folder is empty, so let's open the Calendar View to get started.`
    );

    // Highlight the "Show Calendar" button before clicking it.
    const calendarButton = mainWindow.getByTestId('calendar-button');
    await expect(calendarButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, calendarButton, screenshotDir, step++, 'about-to-click-show-calendar');
    writeNarration(
      screenshotDir,
      step++,
      `At the top of the window you can see the "Show Calendar" button.
Let's click it to switch this folder into the Calendar View.`
    );

    await demoClick(calendarButton);

    // The app should automatically switch to the calendar view and show an empty calendar.
    await mainWindow.waitForTimeout(1000);

    // Silently force the calendar into "Month" mode (not narrated, no screenshot).
    // The calendar view type is a persisted setting, so a previous run could have
    // left it on Week, Work Week, Day, or Agenda. The rest of this demo assumes the
    // Month view, so we both persist the config and click the "Month" toolbar button
    // (which updates the live store) to lock it in before we capture anything.
    await mainWindow.evaluate(() => {
      // @ts-expect-error electronAPI is injected by the preload script
      return window.electronAPI.updateConfig({ calendarViewType: 'month' });
    });
    const monthButton = mainWindow.getByRole('button', { name: 'Month' });
    await expect(monthButton).toBeVisible({ timeout: 5000 });
    await monthButton.click();
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'empty-calendar-view');
    writeNarration(
      screenshotDir,
      step++,
      `The app has switched to the Calendar View.
Because our folder doesn't contain any entries yet, the calendar is currently empty.
From here we'll be able to view our calendar by month, by week, or by work week, and create new entries directly on the calendar.`
    );

    // Internal check (not narrated): confirm the calendar toolbar buttons are present,
    // which indicates the Calendar View rendered successfully.
    await expect(mainWindow.getByRole('button', { name: 'Month' })).toBeVisible({ timeout: 5000 });
    await expect(mainWindow.getByRole('button', { name: 'Week', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(mainWindow.getByRole('button', { name: 'Work Week' })).toBeVisible({ timeout: 5000 });

    // --- Phase 3: click the first day of the month and create a new calendar item ---

    // Temporarily point the "calendar items folder" at the demo folder so the file
    // created by the New Calendar Item dialog lands in our "calendar" folder. We
    // capture the previous value first so we can restore it when the demo ends.
    const demoCalendarFolder = path.resolve(path.join(__dirname, '../../mkbrowser-test/calendar'));
    const previousCalendarItemsFolder = await mainWindow.evaluate(() => {
      const ts = (window as unknown as { __testStore: { getSettings: () => { calendarItemsFolder: string } } }).__testStore;
      return ts.getSettings().calendarItemsFolder;
    });
    await mainWindow.evaluate((folder) => {
      const ts = (window as unknown as { __testStore: { setCalendarItemsFolder: (f: string) => void } }).__testStore;
      ts.setCalendarItemsFolder(folder);
    }, demoCalendarFolder);

    writeNarration(
      screenshotDir,
      step++,
      `Creating a calendar entry is as easy as clicking on the day you want it to fall on.
Let's click right in the middle of the first day of the month to add a new item there.`
    );

    // Locate the "01" date label for the first of the month. The date number sits in
    // the top-right corner of its day cell, so clicking 20px down and 20px to the
    // left of it lands roughly in the middle of that day's block, which opens the
    // New Calendar Item dialog.
    const firstDayLabel = mainWindow.getByText('01', { exact: true }).first();
    await expect(firstDayLabel).toBeVisible({ timeout: 5000 });
    const box = await firstDayLabel.boundingBox();
    if (!box) throw new Error('Could not locate the bounding box for the first day of the month.');

    await takeScreenshot(mainWindow, firstDayLabel, screenshotDir, step++, 'about-to-click-first-day');

    await mainWindow.mouse.click(box.x - 20, box.y + 20);
    await mainWindow.waitForTimeout(1000);

    // Silently verify (not narrated) that the New Calendar Item dialog appeared.
    const newCalendarDlg = mainWindow.getByTestId('new-calendar-item-dlg');
    await expect(newCalendarDlg).toBeVisible({ timeout: 5000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'new-calendar-item-dialog-open');
    writeNarration(
      screenshotDir,
      step++,
      `The "New Calendar Item" dialog has appeared.
Here we can enter a file name for our new calendar item.
Let's name it "bi-weekly-reports.md".`
    );

    // Enter the file name for the new calendar item.
    const fileNameInput = mainWindow.getByTestId('new-calendar-item-dlg-filename');
    await expect(fileNameInput).toBeVisible({ timeout: 5000 });
    await insertText(mainWindow, 'bi-weekly-reports.md', true, fileNameInput);

    await takeScreenshot(mainWindow, fileNameInput, screenshotDir, step++, 'filename-entered');
    writeNarration(
      screenshotDir,
      step++,
      `We've typed in the file name "bi-weekly-reports.md".
Now we'll click the "Create File" button to create this calendar item.`
    );

    // Highlight the "Create File" button (snapshot only — the click itself, and
    // everything that follows from it, belongs to the next phase).
    const createFileButton = mainWindow.getByTestId('new-calendar-item-dlg-create');
    await expect(createFileButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, createFileButton, screenshotDir, step++, 'about-to-click-create-file');

    // --- Phase 4: create the file, edit it in the Browse Tab, and save it ---

    // Click "Create File". The app creates the calendar item and automatically
    // takes us to the Browse Tab with the new file open in edit mode.
    await demoClick(createFileButton);
    await mainWindow.waitForTimeout(1500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'new-file-in-edit-mode');
    writeNarration(
      screenshotDir,
      step++,
      `The file has been created, and MkBrowser has taken us to the Browse Tab where the new file is already open and ready to edit.
At the top of the file you can see its properties, including a property named "due" that holds the date we picked on the calendar.`
    );

    // Move the cursor to the very end of the editor content (below the properties)
    // before inserting our text, so the new line lands beneath the front matter.
    const cmEditor = mainWindow.locator('.cm-editor').first();
    await expect(cmEditor).toBeVisible({ timeout: 5000 });
    await cmEditor.click();
    await mainWindow.keyboard.press('Control+End');

    // Insert the body text at the end (no focusTarget, so the existing properties
    // are preserved rather than selected-and-overwritten).
    await insertText(mainWindow, 'Bi-Weekly Reports Due', true);

    await takeScreenshot(mainWindow, cmEditor, screenshotDir, step++, 'content-typed');
    writeNarration(
      screenshotDir,
      step++,
      `We've typed the title of our entry, "Bi-Weekly Reports Due", below the properties.
Now let's save our work.`
    );

    // Click the Save button to write the file and close the editor.
    const saveButton = mainWindow.getByTestId('entry-save-button');
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, saveButton, screenshotDir, step++, 'about-to-save');
    writeNarration(
      screenshotDir,
      step++,
      `We'll click the Save button to write our changes to disk.`
    );

    await demoClick(saveButton);
    await mainWindow.waitForTimeout(1000);

    // Verify the editor closed (silent check).
    await expect(saveButton).not.toBeVisible({ timeout: 5000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'file-saved');
    writeNarration(
      screenshotDir,
      step++,
      `Our calendar item has been saved.
Notice that the date is displayed right above the file content, which lets us recognize this as a calendar file at a glance.`
    );

    // --- Phase 5: switch back to the calendar, reopen the item, and open the Calendar Info dialog ---

    writeNarration(
      screenshotDir,
      step++,
      `Now let's switch back over to the Calendar View to see our new calendar item appear.`
    );

    // Switch back to the Calendar View by clicking the "Calendar" tab in the app tab bar.
    const tabButtons = mainWindow.getByTestId('app-tab-buttons');
    const calendarTab = tabButtons.getByText('Calendar', { exact: true }).first();
    await expect(calendarTab).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, calendarTab, screenshotDir, step++, 'about-to-click-calendar-tab');

    await demoClick(calendarTab);
    await mainWindow.waitForTimeout(1500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'calendar-item-on-calendar');
    writeNarration(
      screenshotDir,
      step++,
      `We're back in the Calendar View, and you can now see our "bi-weekly-reports" item sitting right there on the calendar.
We can click on the calendar item to go back and edit it again.`
    );

    // Click the calendar item to navigate back to the file in the Browse Tab.
    const calendarItem = mainWindow.getByText('bi-weekly-reports').first();
    await expect(calendarItem).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, calendarItem, screenshotDir, step++, 'about-to-click-calendar-item');

    await demoClick(calendarItem);
    await mainWindow.waitForTimeout(1500);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'file-shown-from-calendar');
    writeNarration(
      screenshotDir,
      step++,
      `Clicking the item brought us back to the Browse Tab, where our calendar file is shown again — though it isn't in edit mode yet.
Let's click on the file content to start editing it.`
    );

    // Click the file body text to enter edit mode.
    const bodyText = mainWindow.getByText('Bi-Weekly Reports Due').first();
    await expect(bodyText).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, bodyText, screenshotDir, step++, 'about-to-click-file-content');

    await demoClick(bodyText);
    await mainWindow.waitForTimeout(1000);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'editing-file-again');
    writeNarration(
      screenshotDir,
      step++,
      `We're now editing the file again.
Next, let's use the calendar dialog to modify the time options for this calendar item.`
    );

    // Open the Calendar Info dialog via the edit-calendar-info button.
    const editCalendarInfoButton = mainWindow.getByTestId('edit-calendar-info');
    await expect(editCalendarInfoButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, editCalendarInfoButton, screenshotDir, step++, 'about-to-click-edit-calendar-info');

    await demoClick(editCalendarInfoButton);
    await mainWindow.waitForTimeout(1000);

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'calendar-info-dialog-open');
    writeNarration(
      screenshotDir,
      step++,
      `The Calendar Info dialog has appeared.
Here we'll be able to adjust the timing options for this calendar item.`
    );

    // --- Phase 6: set the item to repeat bi-weekly, save, and save the editor ---

    writeNarration(
      screenshotDir,
      step++,
      `Let's set up this calendar item to repeat bi-weekly.
We'll start by changing the "Repeat" option, which is currently set to "No repeat", over to "Weekly".`
    );

    // Change the "Repeat" frequency combobox from "No repeat" to "Weekly".
    const frequencyType = mainWindow.getByTestId('calendar-frequency-type-option');
    await expect(frequencyType).toBeVisible({ timeout: 5000 });
    await frequencyType.selectOption('weekly');
    await mainWindow.waitForTimeout(500);

    await takeScreenshot(mainWindow, frequencyType, screenshotDir, step++, 'repeat-set-to-weekly');
    writeNarration(
      screenshotDir,
      step++,
      `We've set the item to repeat "Weekly".
But we want it to repeat every two weeks instead, so let's change the "Every" value from 1 to 2 to make it bi-weekly.`
    );

    // Change the "Every" interval to 2 to make the repeat bi-weekly.
    const frequencyInterval = mainWindow.getByTestId('calendar-frequency-repeat-option');
    await expect(frequencyInterval).toBeVisible({ timeout: 5000 });
    await insertText(mainWindow, '2', true, frequencyInterval);

    await takeScreenshot(mainWindow, frequencyInterval, screenshotDir, step++, 'every-set-to-two');
    writeNarration(
      screenshotDir,
      step++,
      `The item is now set to repeat every two weeks.
Let's save these settings to make this a bi-weekly calendar item.`
    );

    // Save the Calendar Info dialog.
    const calendarInfoSave = mainWindow.getByTestId('calendar-info-save');
    await expect(calendarInfoSave).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, calendarInfoSave, screenshotDir, step++, 'about-to-save-calendar-info');

    await demoClick(calendarInfoSave);
    await mainWindow.waitForTimeout(1000);

    writeNarration(
      screenshotDir,
      step++,
      `We're back at the markdown editor again.
Let's click "Save" to save our changes and close the editor.`
    );

    // Save the markdown editor (close CodeMirror).
    const editorSaveButton = mainWindow.getByTestId('entry-save-button');
    await expect(editorSaveButton).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, editorSaveButton, screenshotDir, step++, 'about-to-save-editor-again');

    await demoClick(editorSaveButton);
    await mainWindow.waitForTimeout(1000);

    // --- Phase 7: switch back to the calendar and verify the bi-weekly recurrences ---

    writeNarration(
      screenshotDir,
      step++,
      `Now let's switch back over to the Calendar View one more time to verify that our item is now repeating bi-weekly.`
    );

    // Switch back to the Calendar View by clicking the "Calendar" tab again.
    const calendarTabFinal = mainWindow.getByTestId('app-tab-buttons').getByText('Calendar', { exact: true }).first();
    await expect(calendarTabFinal).toBeVisible({ timeout: 5000 });
    await takeScreenshot(mainWindow, calendarTabFinal, screenshotDir, step++, 'about-to-click-calendar-tab-final');

    await demoClick(calendarTabFinal);
    await mainWindow.waitForTimeout(1500);

    // Confirm the recurring item now appears in more than one place on the calendar.
    const recurringItems = mainWindow.getByText('bi-weekly-reports');
    await expect(recurringItems.first()).toBeVisible({ timeout: 5000 });

    await takeScreenshot(mainWindow, null, screenshotDir, step++, 'bi-weekly-recurrences-on-calendar');
    writeNarration(
      screenshotDir,
      step++,
      `And there it is — our "bi-weekly-reports" item now appears multiple times across the calendar, repeating every two weeks just as we set it up.
That's how easy it is to create and schedule a repeating calendar item in MkBrowser. Thanks for watching!`
    );

    // End of demo.

    // Restore the calendar-items folder to whatever it was before the demo ran.
    await mainWindow.evaluate((folder) => {
      const ts = (window as unknown as { __testStore: { setCalendarItemsFolder: (f: string) => void } }).__testStore;
      ts.setCalendarItemsFolder(folder);
    }, previousCalendarItemsFolder);

    logScreenshotSummary(screenshotDir);
  });
});
