# Objective: Create a top-level Calendar View/Tab
 
We are creating a calendar view/tab for this application. you will be doing this one phase at a time, so that each refactoring step that you do will be kept fairly simple and will build on the previous phases. I'll be writing each new phase as we go along.

currently, you're doing Phase 3.


# Phase 1 (done)
first, let's create an empty application View/Tab and wire it up to our tools menu (`ToolsPopupMenu.tsx`), so the user can switch to that tab using a Tools menu item. to understand the basic architecture for how tabs are implemented in the application read the document named `docs/technical_notes/GUI/application_tabs.md`. we have a consistent architecture that we use for all of our tabs and that document will help you to understand how to get started working with tabs. so add a new menu item named "Show Calendar" which will display this new component tab, and for now it can simply display a text message "Tab Component Works!". notice there's nothing calendar related in this at all. You're just creating the new tab itself. 

# Phase 2 (done)
We will be using the well known `react-big-calendar` component from NPM. so please install that component now (btw, we use `yarn` to manage packages), and then use some reasonable defaults to get a calendar to display taking up the entire view that we just created, and if you need to create some default data for it to render to show that it's working, you can do that as well. we don't need the calendar to be rendering our real data for now but just some test data will be fine, to demonstrate that the calendar is working. however, you can go ahead and put the calendar data in global state because that's where we're going to be keeping the real data. So we might as well put the test data there right away. keep in mind, we are eventually going to be having an async loading capability, that shows a progress indicator while we're querying the file system to gather the data, so, whatever parts of that async infrastructure you want to go ahead and build out now, is fine, because you could theoretically simulate reading from the file system by putting in some type of a timer that will wait a few seconds before loading the actual data, so we can verify that the progress indicator is working even before we implement the real file system querying for the actual data.

so in other words, the behavior I'm looking for right now is that the user can open the calendar, and it won't display some test data, and it won't try to regenerate any test data just because the user goes back to the view because we're keeping the data in the global state. So the data will simply always be there to be rendered whenever the user goes back to the calendar view.

# Phase 3 (current)
