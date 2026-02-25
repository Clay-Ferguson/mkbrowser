# Goal: Create `ThreadView` Component (Tab)

the following are instructions for our AI Coding Agent to use to build the `ThreadView`. we will be doing this in steps and doing it one step at a time, and each step will be marked as completed once it's done .

## Step 1 (Completed)

we will be creating a new application view which displays the current folder (the same folder that is currently active for the `browser` view), as a vertical list of `MarkdownEntry.tsx` instances, representing the same content that we use when building our AI chat context. we're going to make this new `ThreadView` eventually be the primary view the user will be in when they interact with the AI Chat feature.

this new `ThreadView` will assume that it's in a folder structure that has a particular naming convention for the files and folders which is as follows: each folder will be named either `A` (for AI) or `H` (for Human) or a numbered version of 'A' or 'H' (like A1, A2, A3... or H2, H2, H3...). Each A-Folder will have a file in it named `AI.md`, and each H-Folder we'll have a file in it named `HUMAN.md`. so a long conversation thread on the file system will end up being a folder structure named like `H/A/H/A`, where that example would be for a folder structure where a human has asked an AI a question and gotten an answer back two different times. so this is the file system naming convention that we use so that our chatbot feature can rely on the file system for conversational history. and our new `ThreadView` will exist so that a user can see in one screen the entire history of a particular chat's history.

that's probably all the information you need to build the feature, but I'll give you a little bit more about the specific algorithm you'd follow to populate the view: you'll take the current browser path (which we already have in our global react state) determine whether it's an `H*` or an `A*` pattern, and if not, you'll simply display a message like `Not and AI Thread` and that will be all you'll put in the view; otherwise, you'll know you are in and AI Chat folder, and so you can build the view by walking up the directories, parent by parent, until you reach a folder that is not and `H*` or `A*` pattern and you'll then know, you've reached the beginning of the thread. at each path you encounter as you walk up the folder tree, parent by parent, you'll be gathering the content of the `HUMAN.md` and `AI.md` files at each level. and the array that you're maintaining for displaying this view will have an insert at the head of the array each time, so that when the page is displayed it's in a top-down ordering (which will also be a chronological ordering).

keep in mind, however, that we will eventually be adding the ability to display images or other artifacts along with each `HUMAN.md` or `AI.md` file content, so, rather than storing a simple string for each file, you should instead create an object type (or interface) named `ThreadEntry` and then put a `content` string property in it, and for now, we'll simply be loading that content with the `HUMAN.md` or `AI.md` file content as we walk up the tree. 

for now, don't worry about any of the flow regarding when we automatically display this view. you can just make it initially visible and the only way the user will be able to get to it is by clicking on the `AppTabButton.txs` button for it, to make it the current tab/view.

for general information related to how to create a new appication view here are some tips:

* Look at how the `currentView` variable is used in `App.tsx`, and follow that pattern. 
* `AppTabButtons.tsx` is a tiny file so you can read all of it and understand that first.
* See this line in `types.ts` -> `export type AppView = 'browser' | 'search-results' | 'settings' | 'folder-analysis' | 'ai-settings';`
* Our view components are stored in `src/components/views` in case you need to consult them, and that's also where you'll create the new view.

## Step 2

next, let's make it so that when the user clicks the "New AI Chat" in the `ToolsPopupMenu.tsx` that we automatically switch to the new `Thread` view and let the editing of the new text file take place there. of course, what we do when the user starts a new AI chat is that we create the new `H/HUMAN.md` file and initiate their editing of the file.