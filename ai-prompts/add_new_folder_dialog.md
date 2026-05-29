# Objective: New Folder Operations on IndexTreeView

## Phase 1 (done)

our component named `IndexTreeView.tsx` is a tree component that lets the users explore files and folders. this component works similar to most other file Explorer components, in other applications, where the user can expand and collapse folders to view all the files and folders in a scrollable window. we also have a right-mouse-click to access a context menu that will open when the user right clicks on a folder. 

what I would like for you to do is add to this context menu the new menu item named "New Folder". this menu item will open up a dialog to allow the user to enter a folder name for a new folder to be created as a subfolder under the folder that was clicked. to learn the pattern to follow for creating a dialog, you should look at our existing dialogue named `CreateFileDialog.tsx`, because that's a very similar dialog, and you can follow that exact pattern to create the new dialog. let's name the new dialogue `CreateFolderDialog.tsx` and you'll put it in the folder named `src/components/dialogs`.

obviously, the way this will work will be that the user can open that dialog and then enter a new folder name and then click a "Create Folder" button at the bottom of the dialog, and that will cause the new folder to get created on the file system, and then it will trigger the `IndexTreeView.tsx` to run the function that it currently has to refresh the currently opened folder, which I think is a function that should already exist.

## Phase 2 (current)

Next let's make another new context menu item named "Rename Folder" which we'll open up a new dialogue that you'll create named `RenameFolderDialog.tsx`. it should be obvious how this new menu item will work because it will simply open up the dialog, and default it to the current folder name, and then let the user enter the new folder name, and click "Rename" button. then the dialog should close and the tree should update, of course. in case it helps you to know this, the current way we have for renaming a folder does not involve a dialog, but is simply an edit field rendered in line in the page, so this time, I'm sure you actually will need to create a new dialog. also, let's go ahead and add a divider line above these two new folder menu items that we've added to visually separate them out from the other menu items.