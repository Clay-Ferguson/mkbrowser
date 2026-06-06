# Objective - Create Playwright Test for Demoing (faking) the following contrived AI Chat, exhibiting how our AI Personas work.

## Description of Goal
To understand how we use our Playwrite tests to generate demo videos, read the following files: `docs/technical_notes/tests/playwright.md` and `docs/technical_notes/tests/screen_recording_videos.md`

Next, review this example of an existing test, to understand our pattern so you can follow a similar pattern: `tests/e2e/ai-chat-demo.spec.ts`

When our playwrite tests run, they leaves behind screenshots and narration text files which are later processed by another tool to create a demo video.

Also read the "Document Mode" section of the `USER_GUIDE.md`, to get an end-user perspective on how the Chat View works.

Our goal right now is to create a new Playwright test (named `tests/e2e/chat-persona-demo.spec.ts`), which will be for demonstrating how a user can define a custom Persona for their AI agent and then engage in the chat with that Agent/Persona.

**Phases** - We will be doing this work in phases and right now you're doing only Phase 1. Each phase will build up more onto our existing test, and after each phase you will abruptly end without trying to narrate a good ending to the video, because you won't know when the demo video is about to end until we get to the last phase and I will tell you when that happens. so all your narrations for now should be written assuming that there is more to come. 

## Phase 1 (done)

in this phase you'll create the actual test file, narrate something to the effect that we're going to be looking at how we can define an AI agent persona and then interact with it in a chat. you'll also narrate that we're going to start by opening the "System Popup Menu" in order to access the "AI Settings" view. so you'll click the button identified by `data-testid="system-menu-button"` to open up that pop-up menu, and then you'll take a screenshot of it as you click the "AI Settings" menu item on that menu. then after waiting a fraction of a second you will check to be sure our DOM tree now contains element identified by `data-testid="ai-persona-combobox"` exists, which will be an instance of our `EditableCombobox`. and you'll run a command to scroll it into view because it will be too far down the page to be in view right off the bat. then you'll narrate that we're going to select the item in that check box named "Pirate" (selecting a "Pirate" persona), then you'll narrate something saying that we have this persona defined that will behave like a pirate and write like a pirate. you'll want to also take a screenshot, of course showing the pirate combo box selection.

then you'll narrate that we're going to switch back over to the browse view, which you will do by getting a reference to our tabs bar which is identified by `data-testid="app-tab-buttons"` then you'll click the "Browse" button in that tab bar to switch us back over to the browse view, and you'll take a screenshot of that view again.

then you'll narrate that we're going to start a new chat conversation thread, and that it's under the tools menu and so you'll click the icon identified by `data-testid="tools-menu-button"`, and say something about now we can see the tools menu. then you'll narrate that we're going to click on the "New AI Chat" menu item and then you'll click on that. and you'll be sure to take a screenshot showing the menu items selected as you click on it.

you can abruptly end the demo at this point because we will let this be the end of phase one work. don't narrate anything about the demo being complete however of course.

## Phase 2 (current)

let's modify our test so that the first thing it does is it should delete any file named `HUMAN.md` folder we start out in which is `mkbrowser-test`, because if that file already exists, then we're going to run into a problem when we try to initiate the "Chat" and we get a warning about the file already existing. so we can ensure the demo runs smoothly every time if we simply delete that file (if it exists) when we start the demo.

but continuing on with the demo: at the end of phase one, we should be now sitting with the code mirror editor displaying in the chat tab, and we should of course, take a screenshot of that and narrate that we will now enter a prompt to begin a conversation with our pirate friend.

and so you'll type the following into the editor to be the prompt: "what do you usually do on a warm summer night?".

then you can take a snapshot showing that we've entered that as our prompt. then you'll mention that we're going to now click the "Ask AI" button which is available to us only because the file is named `HUMAN.md`. and so you'll take a snapshot of you clicking on that button.

then we're going to use our approach where we queue up what the AI would have said so that we can fake a call to the LLM without actually calling the LLM (as you've seen in other AI related playwright demos in this project), and so we will queue up the following response that the pirate would have said:

```md
# Ahoy there, Matey! 🏴‍☠️

Shiver me timbers, ye be askin' a pirate about the fine rituals of a warm summer night? Pull up a barrel and lend an ear, for the stars be bright and the sea be calm!

When the sun dips below the horizon and the moon rises like a silver doubloon over the waves, a pirate's work never truly ends, but the rhythm changes. Here be what a salty dog like meself usually gets up to:

### 🌙 A Pirate's Summer Night Rituals

| Activity | Description |
| :--- | :--- |
| **Stargazin'** | Navigatin' the dark waters by lookin' at the constellations. The North Star be our truest guide! |
| **Sea Shanties** | Singin' loud and proud with the crew to keep the spirits high and the rum flowin'. |
| **Watchin' the Horizon** | Keepin' a weather eye open for any merchant ships
```

and then you will have the answer appearing on the screen and you can i mentioned that now we've learned a little bit about pirate nightlife.

at this point, I will leave it up to you to come up with a good follow-up question so that we can use the reply button (data-testid="ai-reply-button") to ask the pirate one more question. maybe ask the pirate if he's heard about the new device people use on ships to help navigate by the stars, and what his current device is. so you can take a snapshot after you've hit the reply button and entered your question into the edit field. 

you can of course prepare a response that you will think of yourself and cue that one up again so that it's not going to be a real LLM call, and then show yourself clicking the "Ask AI" button again, using a screenshot as always.

then you'll wait for your own answer to pop up, and you'll narrate something clever about what the answer says. and of course you'll be taking a screenshot of the answer after it came up. by the way, for this second answer, you'll need to run a "scroll to bottom" command somehow on the page to be sure that the quick from the pirate is visible on the screen.

then after your quip about the pirate's second answer, you'll gracefully wrap up the video and that will be the end of this demo.


