# Objective - Create Playwright Test for Demoing (faking) how users can create custom Hashtags and add them to files

## Description of Goal
To understand how we use our Playwright tests to generate demo videos, read the following files: `docs/technical_notes/tests/playwright.md` and `docs/technical_notes/tests/screen_recording_videos.md`

Next, review this example of an existing test, to understand our pattern so you can follow a similar pattern: `tests/e2e/create-file-demo.spec.ts`

When our playwright tests run, they leaves behind screenshots and narration text files which are later processed by another tool to create a demo video.

Also read the "Document Mode" section of the `USER_GUIDE.md`, to get an end-user perspective on how the Tags feature works (i.e. tags edited in `TagsEditorDialog.tsx`, and then added to files using `TagsPicker.tsx`).

Your task right now is to create a new Playwright test (named `tests/e2e/custom-tags-demo.spec.ts`), which will be for demonstrating how a user can view their tags (thru the button on `SettingsView.tsx`), and then create a markdown file and add some tags to it.

if you get stuck or confused at any point regarding how our tests work we have a bunch already that you can refer to that are in this folder: `tests/e2e`

here's how the flow of the test/demo flow should work:

you'll narrate something about this being a demo showing how custom hashtags are defined and used. then you'll say that you're going to go to the settings panel to edit the tags in there, then you'll go to the settings panel and click the button to open the tags dialog, you can then close that dialogue without adding any new tags because it will be self-explanatory. by the way, you'll be taking screenshots and doing the appropriate narration everywhere as you go along like other tests do. then you'll go back into the Browse tab and you'll create a new file and you'll select the button above the file that displays hashtags during editing and then you'll pick a couple of hashtags (maybe select "#p1" and "#note") and you'll of course highlight those tags as you're clicking on them, narrating to the user what you're doing, and then you'll close the file and you'll mention that we can now see the tags pills displaying above the file.

this will be a little bit challenging for you because I'm not giving you the exact steps for every single little mouse click you'll need to make, but I thought I would let you try to create this entire test script all on your own and see how you do. if you get stuck at any point during this process, feel free to temporarily stop to ask me for a question about anything. but I think given the fact that we have so many existing test cases for you to prefer to, and because you're a model with high intelligence, you can probably figure out how to do this entire test yourself.