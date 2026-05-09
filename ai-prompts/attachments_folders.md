# Objective: Create Attachments Folders 

it's very common in this personal knowledge-base application to have a markdown file, which needs to have other file attachments associated to it. for example, you might have a markdown file that needs to reference a few images, and so we need a clean way to have those images be associated with the file itself. we're going to be designing the feature that can support this. our solution is very simple, because we're just going to allow our application to recognize whenever there is a folder name that matches a file name except the folder will have the suffix of ".attach". for example, if we have a markdown file named 'my-screenshots.md', then we want our system to automatically recognize that a folder by the name of `my-screenshots.md.attach` will hold any attachments that are associated with the file.

we're going to implement this feature in phases, where each phase is very focused and simple for you to implement and builds on top of the previous phase. 

you're doing phase 8 now.

## Phase 1 (done)

you will modify `BrowseView.tsx` to make it aware when it encounters an "attach" folder, and you will render the content of the attachment folder in line-in on the page, below the `FolderEntry.tsx` component, but with a left indentation which will visually indicate that we have traverse into the subfolder to render the content of the subfolder. you should also take a hierarchical approach when you do this, because it should be just as easy as the non-hierarchical approach, really. that is to say when we're generating the rows, and we encounter an "attach" folder we should be able to call a recursive method and pass it a 'level' argument (in addition to any other arguments you need) so that it can do the indentation based on the depth level of the recursion, but other than that, everything about the render will be the same, where files are rendered the normal way, and whenever we encounter any additional "attach" folders during the rendering we will increment the level, and do the recursion down into that new "attach" folder.

the only thing that could make this slightly tricky is that you do need to take into account and remember that our algorithm for rendering items on the page is either unordered rendering as controlled by the sort ordering the user has selected, or the other way the page might be rendered is if it is a "Document View" (see `document_mode.md`) in which case the `.INDEX.yaml` file will control the ordering. but since we've already taken care of all of the ordering , including for the special case of "Document View" in our existing code, you should be able to know how to write the recursive method to follow the same ordering algorithm.

To be clear about how this needs to work on the back end, what we should do is add and "attachments" optional array (array of `FileEntry` objects) variable to the `FileEntry` interface, and then we will only have one place where we scan the file system, so that as we're building up the the holder structure for the `BrowseView` items, we will be building out any attachments as we go along. this way the GUI component will be completely decoupled from the data loading, and it will just be able to assume that it only needs to check for the "attachments". i guess it would be the folder itself that would have the "attachments" array populated for it, rather than the file. so please make this change and I think it will actually be simpler, cleaner and better code. 

## Phase 2 (done)

when the current folder is a "Document Mode" one, we have two icons buttons that we display between each file/folder which are named "insert file here" and "insert folder here". we need to make our `BrowseView.tsx` page rendering be smart enough to never show those two icons above an "attach" folder, because we will never be letting the user insert files and folders at that location. 

## Phase 3 (done)

when the current folder is a "Document Mode" one,  and we're rendering an "attach" type folder we also want to make the folder name be invisible most of the time until the mouse is hovered over the header bar, in the `FolderEntry` header. it was tricky to get this hover styling exactly the way I wanted, because I have a very specific timing and animation styling that I use for this. so you should refer to the styling on the `EntryActionBar.tsx` which also appears in the same header (write "justified" to the right of the folder name ) because the styling on that action bar as exactly the right mouse hovering visibility animation that we want to apply to the folder name. in other words, we want the folder name to be invisible most of the time, just like the `EntryActionBar.tsx` icons are, and when the action icons fade in, we will be having the folder name fade in exactly the same way at the same time. to be clear, I'm not talking about hiding the folder icon itself, just the text for the file name, the folder icon and even the checkbox can all remain visible all the time, in this folder header area we're talking about.

## Phase 4 (done)

when the current folder is a "Document Mode" one,  and we're rendering an "attach" type folder we also want to always hide (never show) the "Move Up" or "Move Down" buttons in the `EntryActionBar.tsx` regardless of whether edit mode is on or not. 

## Phase 5 (done)

when the current folder is a "Document Mode" one, and we are NOT in edit mode for the document, let's just skip the rendering of the entier `FolderEntry` so that no folder entries show up at all unless edit mode is on. this we'll create a much cleaner screen display where files that have attachments will display the attachments directly below them without any folder in between.

## Phase 6 (done)

We need to make sure that the "attach" folders, always stay synchronized with the file name the file they're associated with, whenever the user renames a file using the rename button in the `EntryActionBar.tsx`. so this means we simply need to hook into the rename logic to do that post processing to check to see if there is an existing "attach" folder, whenever a file is being renamed, and if so, we rename the "attach" folder accordingly. let's keep it just as simple as that and i don't want to try to account for the situation where the user may have rename something directly in their file system outside of our application. as long as we make our rename function in this application take care of the updating of the folder name that will be sufficient and is all we need to do .

## Phase 7 (done)

when the current folder is a "Document Mode" one (i.e. has a `.INDEX.yaml` file) there are numerous different scenarios in which the "attach" folder could end up in our YAML file in a location that is not immediately following the file that the "attach" folder is associated with. the simplest approach to dealing with this is to create a utility method in `indexUtil.ts` named `validateAttachFolderLocation`, which we can run at various times when we know an update might be required two get the "attach" folder back where it belongs relative to its associated file. for now, you can make the last step in the "Move Up" and "Move Down" logic be to call this new validation function, because we know when files are moved around, there's the potential that an "attach" folder might now be incorrectly located.

i will let you invent an efficient algorithm for how `validateAttachFolderLocation` should work, but my naive first guess would be to use an algorithm like the following:

Algorithm:
1. you'll first clone a copy of the `files` into a list called `tmpFiles`
2. you will scan the `tmpFiles` to first collect a list of all the "*.attach" folder names, and hold them in `attMap` map (for fast access).
3. then you will filter the `tmpFiles` array to make it exclude anything that has been put in `attMap`
4. then you'll create a new empty list that will become the final files in `finalFiles`
5. then you'll iterate over `tmpFiles` (in order of course) and add each file or folder in it into `finalFiles`, but after each one, you'll check to see if there is an existing `attMap` associated theh item, and if so, then it needs to be added, thus ensuring that any "abc" entry is followed by any "abc.attach" that goes with it.
6. i'm not sure how you'll then compare the original and final list to see if anything changed, but it would be maybe nice to not write the file back out unless something changed?

like I said, if you know of a much cleaner algorithm could use, that might even make it easier to detect if a change had occurred, then, feel free to use your method instead. because really the only way I know of to detect a change, would be to create a before and after list of just the file names, and then use some type of array compare function to see if the arrays are identical or not. theoretically, you could even concatenate them all into a string and compare the two strings before and after, but that seems like it might be less efficient. it's your call, so use your judgment to create simple clean code, as always .

## Phase 8 (current)

for this phase, we're actually going to do some troubleshooting of a bug. sometimes the checkboxes on the attachment items (i.e. files inside the 'attach' folders, that appear on the page, below the file they're associated with ), don't appear to do anything when I click on them. it seems like the checkbox is just ignoring the mouse click. unfortunately, the problem doesn't always reproduce. Sometimes it happens and sometimes it doesn't. can you take a look and see if you can spot the problem? don't waste a ton of effort on this because if it's going to be true tricky to figure out then we'll just use some log statements and we can put in log statements to see if the mouse click is getting seen or not . but I wanted to give you a chance to at least look at the code first and see if something jumps right out at you as the obvious problem .