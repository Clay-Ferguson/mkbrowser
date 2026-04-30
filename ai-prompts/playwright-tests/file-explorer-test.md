# Objective - Playwright Test for "File Explorer Tree" Feature.

## Status
**IMPORTANT** - You have already done Phase 1 and Phase 2 of this work (see below), and you are now doing Phase 3.

## Description Goal
First, to understand how we ultimately use our Playwrite tests to generate demo videos read the following file: `docs/technical_notes/tests/playwright.md`

Next, review this example of an existing test, to understand our pattern so you can follow a similar pattern: `tests/e2e/advanced-search-demo.spec.ts`

When that test runs, it leaves behind screenshots and narration text files which are later processed by another tool to create a demo video.

So our goal now is to create a new Playwright test (named `file-explorer-demo.spec.ts`), which will be for testing our File Explorer component (the `IndexTree.tsx` component). We will be testing (and demoing) that we can click on sections of the tree to expand several sections and explore to a file and expand the file to demonstrate that our tree can also drill into files based on the markdown heading structure, so that the markdown headings become a part of the tree displayed underneath markdown files.

The top level of the Explorer Tree is identified with `data-testid="file-explorer-tree"` DOM so Playwrite can find it.

# TEST FLOW

## Phase 1 (Complete)

- Start browsing in '/home/clay/ferguson' folder.

- Narrate that we'll be doing exploring of files and folders in the "File Explorer Tree" on the left hand side of the app.

- Click on the "projects" folder (simple DOM search and click in the Tree component), and narrate this is a projects folder

- Next open the "mkbrowser" folder (click it) and narrate that we're opening the MkBrowser folder, next.

- Next narrate about the 'docs' folder also and click on it as well, to open it.

- Next we'll be seeing a file named `USER_GUIDE.md` and click on it to expand it, to show the markdown headings that appear underneath it.

## Phase 2 (Complete)

- Next without mentioning to the user anything about it, run a command to scroll the tree element containing "Searching" into view because otherwise
they will be not at a great scroll location until you do that.

- Next mention that you'll do a right-mouse click on the `USER_GUIDE.md` file to cause the right hand side of the app to open the folder containing that document
and display it. I'm not sure we support right-clicks yet in our helper functions but if now I think you'll know how to add that capability.

- Next mention that we can also continue to expand headings in the tree and click on heading named "Seaching", so that it reveals children in the tree (subheadings)

- Then mention we'll right click on the subheading on the tree named `Saving Search Definitions` and right click it.

- This should have caused the right hand side to scroll the `Save Search Definitions` section of the document into view.

## Phase 3 (Do this now)

- Next mention that we we just jumped from the Tree to the Document, but that we can also jump from any document over to the tree view, and show how we can collapse the 
tree completely by clicking `data-testid="file-explorer-tree-collapse"` (on the tree), collapse it.

- Then issue a scroll call in the right hand side by scrolling the DIV identified as `data-testid="browser-main-content"` to the top, where we can get access to the icon
named "Reveal in Folder Tree" which will be identified by `data-testid="entry-reveal-button"`, and you can click that icon to make the tree find and display this file. The only tricky part of this is that you need to click the copy of the `entry-reveal-button` that's closest to the text 'USER_GUIDE.md' in the DOM. I think Playright has a way to do DOM-type proximity search for this, and we will need to because there will be multiple copies of that reveal button on the page, because it's in the header for each of the file components and folder components. if it's not obvious how to find the correct copy of the reveal button, let me know and i can give you a different way to do it other than proximity , if necessary .

- and finally, you can mention that all of the elements on the tree that are the parent of the current folder are always highlighted in purple. And mention that the user will see the purple coloring on the tree indicating what the current item is on the right hand side of the app .

# Notes:

- You should abruptly stop here, because there is more to come in this test, but we won't write it now, so don't try to narrate an ending to the test, just allow the 
images and narration to stop after the step above.

- Before you attempt any of those clicks mentioned above remember the things being clicked on might not be visible so try to use the browser to scroll the element to visible before highlighting it and mention it. The example I provided has highlighting (maybe done in the helper methods) so we'll have highlighting on everything we click
in this test/demo as well.