# Objective - Playwright Test for CalendarView

## Description of Goal
To understand how we use our Playwrite tests to generate demo videos, read the following files: `docs/technical_notes/tests/playwright.md` and `docs/technical_notes/tests/screen_recording_videos.md`

Next, review this example of an existing test, to understand our pattern so you can follow a similar pattern: `tests/e2e/advanced-search-demo.spec.ts`

When our playwrite tests run, they leaves behind screenshots and narration text files which are later processed by another tool to create a demo video.

Also read the "Document Mode" section of the `USER_GUIDE.md`, to get an end-user perspective on how the Calendar View works.

Our goal right now is to create a new Playwright test (named `tests/e2e/calendar-view-demo.spec.ts`), which will be for testing our `Calendar View` feature (and of course generating screenshots and narration files for the demo video)

**Phases** - We will be doing this work in phases and right now you're doing only Phase 1, because earlier phases are complete. each phase will build up more onto our existing test, and after each phase you will abruptly end without trying to narrate a good ending to the video, because you won't know when the demo video is about to end until we get to the last phase and I will tell you when that happens. so all your narrations for now should be written assuming that there is more to come.

# TEST FLOW

## Phase 1 (done)

Start our test by opening the app at folder named `mkbrowser-test/calendar` and narrating that we're going to create a repeating (weekly) calendar item, and that we're in a folder named 'calendar' that we created to hold calendar entries. Narrate that we'll click the "Show Calendar" button, and click it (data-testid="calendar-button"), using the click. We'll have the initial screenshot and a screenshot showing that calendar item being clicked. Then you'll expect the app to switch to the calendar view automatically and display an empty calendar, and you'll narrate about this also. 

you can run the playwright DOM element Lookups to verify that we have buttons on the screen for all three of these buttons with the following text "Month", "Week", "Work Work Week", because that will indicate we've successfully displayed the calendar view. you will of course not narrate anything about this check though. This is an internal check to make sure that the code ran successfully.

right here you can just abruptly end the test because this is the end of phase one, but there are more steps to come so don't narrate anything about that being the end of the demo because it's not.

## Phase 2 (done)

next, we need to alter some of the Phase 1 code that we just wrote. we need to make sure that when the calendar comes up it will be displaying the "Month" type mode for the calendar component. the calendar component supports buttons on the upper right hand corner that are labeled "Month", "Week", "Work Week", "Day" and "Agenda", and our application persists those settings so that for example once the user clicks the "Month" button, they will be locked into the monthly view until they change it. but this means that our demo cannot assume that the user is locked into the "Month". so, in the code above, we need to silently set the variable to ensure that we're going to come up and "Month" mode, so that our demo can make that expectation right off the bat, and we can write all of our demo code making that assumption, because it will make a difference. so I'm just asking you to tweet that variable value, which I think is a global state variable.

## Phase 3 (done)

next, in Phase 3, we will continue on where phase 1 left off with our demo, and I would like for you to narrate that we're going to click in the middle of the first day of the month in the calendar, and then do a click in the middle of calendar view item for day one. i think the way you can know where to do this mouse click is to search the DOM for an element containing the text "01", and then do your click at a location that is 20 pixels down and 20 pixels to the left of that text element, because that should be right in the middle of the day block for the first day of the month. if you happen to already know the dong structure for this component and you know a better way to click on the first day of the month in this component using playwright, then feel free to do that however way you want to, if you know of a better way than what I've just said. 

now the next part of this test involves opening a dialog box, we need to run the code `setCalendarItemsFolder(calendarItemsFolder)` (see `SettingsView.tsx`) to temporarily set the location where calendar items are stored, only for the duration of this demo, and then we want to set it back to what it was before the demo ran. in other words, it's a little bit tricky because the demo needs to have the calendar items folder be the folder that we're working in for this demo, but then we need to set it back to what it was before we ran the demo. this will make the file that's created by the `NewCalendarFileDialog` go into the correct folder location to make our demo work.

anyway, once you've done that mouse click, you we'll expect the "New Calendar Item" dialogue to appear (i.e. `NewCalendarFileDialog.tsx`), and you can silently verify that by verifying that you can find the dome element identified by `data-testid="new-calendar-item-dlg"`. you'll then narrate something about how we're going to enter a new file name for our calendar item, and then you'll enter the file name text as "bi-weekly-reports.md", and you'll take a screenshot so that the user can see this text has been entered into the get it, field (data-testid="new-calendar-item-dlg-filename"), and you'll mention that you'll click the "Create File" button ( data-testid="new-calendar-item-dlg-create"), by doing the button click that highlights that button, taking a snapshot of the highlighted button as well. 

and you can abruptly end here after you mention that we're clicking that "Create File" button without assuming that you know what's going to come after you click that button because that will be the next phase.

## Phase 4 (done)

let's make our test case start out by deleting any existing `calendar-view-test.md` file, so that it will always run smoothly we will have a condition where that file starts out not existing.

now we will continue on with the flow of the test. the user just clicked the "Create File" button and so we will expect the screen to now be displaying the `BrowseView.tsx`, because the application automatically takes us there to display the new file and automatically has the new file in edit mode. so you'll narrate something about us now seeing the new file being edited in the "Browse Tab". you'll of course also take a screenshot of what the page looks like at this point.

then you'll want to enter the following text into the "Code Mirror" editor: "Bi-Weekly Reports Due", being careful to insert that to the end. in other words, there will be front matter, properties, visible in the editor, but if you enter the text at the very end (like scrolled to the end) of the editor text, then you will be sure to get it below the front matter.

also, I forgot to mention it, but you can also narrate that the date property will be visible as one of the properties at the top of the file. when you narrate be sure to all the front matter "properties" because we don't use the phrase "Front Matter" with users because that's a technical term. users think of their date as a property named "due" so you can mention that it's a property named "due".

then you will click the save button to close the code mirror editor, and you will abruptly end right there because there's more to this demo to come, although you can take a screenshot after the file has been saved and mentioned that now we can see the saved file, and you can also mention that the date will be displayed above the file content allowing us to be able to identify that it's the calendar file.

## Phase 5 (done)

next, you can narrate that we will now switch back over to the calendar view, to see our calendar item appear. and the way you'll do that is by looking for the element identified by `data-testid="app-tab-buttons"` and then clicking the tab element in there which will be the element that contains the text "Calendar". you can take a snapshot of your clicking on that button, perhaps. 

then you'll assume that the calendar view has been selected, and we're now looking at the calendar view again. you can then narrate something about how we can now see the calendar item existing on the calendar. now you can narrate something about how we can now click on the calendar item to go back to edit it again. you'll look up the DOM element on the screen that contains the text "bi-weekly-reports", and y'all take a snapshot of yourself clicking on that on the calendar. then you can assume that after clicking on that calendar item, we will have switched back over to the browse tab, and the new calendar file will be visible once again, although it won't be in edit mode yet. so then you'll narrate that we are going to click on the file content in order to start editing the file which you can do by searching for the text  "Bi-Weekly Reports Due" on the screen and clicking that text. once you've clicked on that text, you'll assume that we're now editing the file again, and you'll narrate something to that effect and take a screenshot, of course. then you'll mention that we now want to use the calendar dialog to modify the time options for this calendar item and you'll click on the button identified by `data-testid="edit-calendar-info"`, in order to open the Calendar Info Dialog. you can then expect the calendar dialogue to pop up after you make the button click, and the calendar info dialog will be appearing on the screen and you can narrate something about that and then take a screenshot as well. 
okay 
you will abruptly end here and we will continue the rest as phase 6.

## Phase 6 (done)

now you will narrate that we're going to set up this calendar item to repeat biweekly, and you will look for the combobox, identified by `data-testid="calendar-frequency-type-option"`, that's currently displaying "No Repeat" and you'll click it to select the "Weekly" option from that combo box, and take a snapshot and mention that you've done that. then you'll mention that we need to make it my weekly instead of weekly, and so you'll look for the edit field, identified by `data-testid="calendar-frequency-repeat-option"`, labeled "Every" and you'll enter the value "2" into that text field, and then you'll narrate that we can now save and you'll click the save button (i.e. `data-testid="calendar-info-save"`), for a bi-weekly option now. then you'll narrate that we're now back at the markdown editor again and so we can click , "Save" to save out of the code mirror editing, so you'll click the save button and take a screenshot of yourself clicking it .

## Phase 7 (current)

then similar to what you did above previously in this test case where you had clicked on the calendar tab to go back over and view the calendar , you'll now be doing that again and you'll be narrating now that we're going to go back over to the calendar to verify that the item is now showing up as a biweekly item, and so multiple occurrences of it will appear in the calendar .

you'll then narrate something indicating that this is the end of the test, and you're gracefully wrap up the test with a final narration