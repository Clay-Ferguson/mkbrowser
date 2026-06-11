# Objective - Create Playwright Test for Demoing (faking) the following contrived `AI Rewrite` Feature 

## Description of Goal
To understand how we use our Playwright tests to generate demo videos, read the following files: `docs/technical_notes/tests/playwright.md` and `docs/technical_notes/tests/screen_recording_videos.md`

Next, review this example of an existing test, to understand our pattern so you can follow a similar pattern: `tests/e2e/chat-persona-demo.spec.ts`

When our playwright tests run, they leave behind screenshots and narration text files which are later processed by another tool to create a demo video.

Also read the "Document Mode" section of the `USER_GUIDE.md`, to get an end-user perspective on how the Chat View works.

Our goal right now is to create a new Playwright test (named `tests/e2e/ai-rewrite-demo.spec.ts`), which will be for demonstrating how a user can define a custom Persona for their AI agent and then use it to rewrite text for them.

**Phases** - We will be doing this work in phases. Each phase will build up more onto our existing test, and after each phase you will abruptly end without trying to narrate a good ending to the video, because you won't know when the demo video is about to end until we get to the last phase and I will tell you when that happens. so all your narrations for now should be written assuming that there is more to come. 

it should be helpful to know that this new test we're doing (`ai-rewrite-demo.spec.ts`) will be extremely similar to the existing test I mentioned above (`chat-persona-demo.spec.ts`) except we're working with a different persona this time and we're using the "AI Rewrite" but instead of the "Ask AI" button, and we're not doing a chat conversation, but we're doing a co-authoring scenario where our persona helps us write content/

## Phase 1

in this phase you'll create the actual test file, narrate something to the effect that we're going to be looking at how we can define an AI agent persona and then interact with it using the "AI Rewrite" feature. you'll also narrate that we're going to start by opening the "System Popup Menu" in order to access the "AI Settings" view. so you'll click the button identified by `data-testid="system-menu-button"` to open up that pop-up menu, and then you'll take a screenshot of it as you click the "AI Settings" menu item on that menu. then after waiting a fraction of a second you will check to be sure our DOM tree now contains element identified by `data-testid="ai-persona-combobox"` exists, which will be an instance of our `EditableCombobox`. and you'll run a command to scroll it into view because it will be too far down the page to be in view right off the bat. then you'll narrate that we're going to select the item in that check box named "Hemingway" (selecting the "Hemingway" persona), then you'll narrate something saying that we have this persona defined that will write in the style of Hemingway.

you'll then scroll to be sure "Enable AI Rewrite" checkbox (data-testid="enable-ai-rewrite") and "Rewrite using Full Doc Context" checkbox (data-testid="rewrite-using-full-doc-context") are both visible, and narrate something about you clicking both of those to enable them and then enable them, taking a screenshot showing them enabled, of course.

then you'll narrate that we're going to switch back over to the browse view, which you will do by getting a reference to our tabs bar which is identified by `data-testid="app-tab-buttons"` then you'll click the "Browse" button in that tab bar to switch us back over to the browse view, and you'll take a screenshot of that view again.

Then you'll narrate that we're going to create some file and then let our agent write some content into the file for us, that's it for co-authoring a document.

So you'll silently delete any existing file named `scary-novel.md` before going on, but then you'll narrate that you're going to click the "Create File" button (data-testid="create-file-button"), and then click it. Actually just read the test named `tests/e2e/create-file-demo.spec.ts` to be sure you know how to create a new file, and so you can use that approach to create the new file named `scary-novel.md`, but don't click save to save the file yet because we're going to stay in the editor and enter the following text below:

This will open the code mirror editor and the editor will have focus and you can then paste the following text into it, but doing narration saying we had just typed the following text:

```
Then he heard the sound again outside the cottage door. It was a creepy sound. Not a scraping and not a thump, but a little of both. The hairs stood up on the back of his neck and his arms, and suddenly he was sure there was something out there.

Slowly he got up from the chair reaching for his...
```

you can then narrate that this is the text we want the AI to rewrite for us, and you'll mention that since we enabled rewrite mode we have a button named "AI Rewrite", and so you'll mention that we're going to cook it to have the entire file get rewritten in the style of Hemingway. then you'll of course click that "AI Rewrite" button.

you can abruptly end the demo here because I have to write some code before we can do the rest of the demo.

## Phase 2

for phase two, we're going to alter the test so that we're injecting a "queued" (mocked) response, to be ready to intercept the rewrite LLM command and make it respond with the following:

```
Then, through the heavy, stagnant air of the room, he heard it again. The sound came from just beyond the cottage door, cutting through the silence like a dull blade. It was not a sound one could easily name. It was not the clean scrape of a branch against stone, nor was it the sudden, honest thump of a falling weight. It was something more complex and more terrible—a rhythmic, unsettling fusion of both, a sliding weight that seemed to drag itself across the threshold.

A sudden, cold electricity surged through him. The hairs on the nape of his neck rose, stiff and sharp, and a similar prickling sensation raced down the length of his arms, as if the very air had turned to needles. In that moment, the uncertainty that had plagued his thoughts for hours vanished, replaced by a hard, crystalline certainty. There was something out there. Something waiting in the dark, breathing the same warm summer night.

With a deliberate, agonizing slowness, he rose from the chair. His movements were heavy, as if he were moving through deep water, and his heart beat a steady, hollow rhythm against his ribs. He reached out, his fingers trembling slightly, searching for his...
```

feel free to alter the `MarkdownEntry.tsx` as necessary to be able to handle the special case of the "rewrite" AI code flow, because it's very different from the chat code flow (i.e. different from the "Ask AI" code flow).

so what we should end up with at the end of phase two is we should have the `MarkdownEntry.tsx` displaying the `DiffReviewEditor` so that the user will be seeing the diff viewer showing the original text and the rewritten text waiting for them to accept changes. 

i guess I'll go ahead and task you with making it where the test goes ahead and narrates that the user is going to accept the changes and so you'll make the appropriate click in the `DiffReviewEditor`, and that might require you to add any necessary `data-testid` attributes to any of the DOM elements that you need to in order to be able the diff viewer select the changes. this may be tricky, so feel free to let me know if you're not sure how to do this at all, but I thought I'd go ahead and ask you if you can implement this yourself. 

by the way, you may also notice that even after you select the button to accept the diff change there will still be one more button click you'll need to make in order to go ahead and actually save the final changes, and then even at that point you'll be sitting back in the code mirror editor now and you can at that point either save or cancel the code mirror editor itself, and so I would like you to click the save button on the code mirror editor to go ahead and save the whole thing. you're gonna be saving the rewrite text that we got from the [fake] LLM call.

i realize I'm throwing a lot at you for this phase 2 work, without giving you the exact button clicks to make, causing you to have to research the code flow yourself. But like I said, I want to see if you can do this on your own, but feel free to ask me for any inputs if you get stuck along the way, because I can give you specific help as you need it so feel free to ask.

