# Objective: Create a top-level Calendar View/Tab
 
We are creating a calendar view/tab for this application. you will be doing this one phase at a time, so that each refactoring step that you do will be kept fairly simple and will build on the previous phases. I'll be writing each new phase as we go along.

currently, you're doing Phase 1.


# Phase 1 (current)
first, let's create an empty application View/Tab and wire it up to our tools menu (`ToolsPopupMenu.tsx`), so the user can switch to that tab using a Tools menu item. to understand the basic architecture for how tabs are implemented in the application read the document named `docs/technical_notes/GUI/application_tabs.md`. we have a consistent architecture that we use for all of our tabs and that document will help you to understand how to get started working with tabs. so add a new menu item named "Show Calendar" which will display this new component tab, and for now it can simply display a text message "Tab Component Works!". notice there's nothing calendar related in this at all. You're just creating the new tab itself. 

