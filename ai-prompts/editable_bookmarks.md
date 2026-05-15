# Objective: Editable Bookmarks

in our `EntryActionBar.tsx` we have a button that lets the users bookmark the file or folder, and currently a bookmark is simply a string value. and importantly, if you look in the `AppSettings` interface definition you can see that when we do the persistence into the config file it's also a type of `string[]`. however, I would like to change this so that we can have a user editable display name that goes along with each bookmark. we're going to do this in phases, so you're doing only a small amount of work at a time. we will tackle each phase below one at a time.

you're currently working on phase 5

# Phase 1 (done)

let's create a new interface or type, named `Bookmark` that can hold the values for a single bookmark. we want this object to have two properties: 1) path (string type) 2) name (string type). when we create a new bookmark, let's default the name to be equal to the path. don't worry about backwards compatibility with the old format of the config file, because no customers are using the app yet, and I will remove my old bookmarks myself to start clean. so in Phase 1, there will be no discernible change to the application behavior except for the fact that we're using the new `Bookmark` object and persisting it into the config file.

# Phase 2 (done)

Let's create a new dialog named `BookmarkDialog.tsx`, which will allow the user to edit the `name` of the bookmark, but we'll display the path at the top as a read-only string. you can refer to the `ReplaceDialog.tsx` to learn all about how we architect our dialogs, and you can also follow the example in that dialogue to know how to handle edit field in a dialogue as well. for now, the only time we will present this dialogue will be when the user first creates a bookmark. if the user is bookmarking a file then you should default the value of the name field to be just the file name part, without the path, and also without the file name extension. you will do a similar thing if they are bookmarking a folder except don't try to remove the extension if it happens to be a folder.

# Phase 3 (done)

Let's make the `BookmarksPopupMenu.tsx` display the 'name' instead of a path-based value. Also let's use some sort of layout where we can have a little icon button section that's right-floated in the menu, so that we can have an "Edit" and "Delete" icons displaying in the menu. Don't try to make the Edit and Delete functional yet. That will be a future phase, but make the buttons log a message to the console when clicked so we can confirm they work.

# Phase 5 (done)

next let's make the edit and delete buttons fully functional. obviously for the edit button you're simply going to open the `BookmarkDialog`, and for the delete button it's self-explanatory, how that should work, so you can do the obvious thing for that.

