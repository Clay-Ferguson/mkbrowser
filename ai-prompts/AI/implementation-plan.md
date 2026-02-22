# Adding AI to MkBrowser Application

This file is instructions for the AI coding agent. If you're an AI Agent seeing this file, you should do what it says in the steps below. 

We will be adding AI capabilities to this application. This document will contain a step-by-step sequence of refactoring steps, where we will logically, have each step building upon the previous step, to get to our final architecture. As we begin at step one, there are no AI capabilities in the app at all and LangChain/LangGraph as not yet been added to the project. We will not be writing any of the steps ahead of time, but we'll be writing the steps as we go along and implementing each new step one at a time. Each step will be written as a prompt, to you (the AI Agent), telling you what to do for that step.

# Step 1 (done)

Based on the assumption that we're going to eventually be building a full-featured chatbot (with support for tool calling, file attachments) into this application, i'm thinking we probably need LangGraph instead of simply LangChain, to be installed with our `yarn` package manager, so please do this first. Then write a simple test case named `tests/ai.test.ts`, that demonstrates we're able to run the AI API calls against a remote cloud service. We'll be using Anthropic as our cloud provider, and you can expect the API key to be in the environment variable 'ANTHROPIC_API_KEY'. part of this test script should be to check the existence of that key and make sure it's set. You can follow the conventions and patterns you see in our existing `search.test.ts` test file, if you have any questions about how to set up the test. as for the content of the test itself just run the query "What is 3+4?", then, assert that the response does contain the text "7" or "seven".

# Step 2 (done)

Now we're going to begin our GUI work. We're going to make it where any markdown file named `HUMAN.md` we will automatically have an "Ask AI" button in the header of the `MarkdownEntry.tsx` component. If the user clicks this button, we will submit the entire content of the markdown file as an AI prompt, and when we get the response back from the AI, we will write the text representation (which will likely also be markdown) into a file named `AI.md` and in a subfolder named "A" (A==Agent, H=Human), underneath the folder that contained `HUMAN.md` (creating the "A" folder, if it doesn't already exist). in other words, all of the responses from the AI always go into the subfolder named "A" and into a file named "AI.md". If an "A" folder already exists we look for the next numbered folder to use ("AI1, AI2, etc"), using the first available numbered folder we find.

Now because I can foresee that there's going to be significant amount of code that we will have related to AI functionality, let's create a new project folder for all of the AI source, and put it in a folder named `src/ai`. for now you can simply put everything in `src/ai/aiUti.ts`, but try to put anything AI specific that you can, into that file. Since we've already accomplished step one above, you can look inside `ai.test.ts` if you have any questions about how to interact with the AI.

# Step 3 (done)

Now we're going to add the ability to include the full context of a conversation to send to the AI whenever the user clicks "Ask AI" button. Based on steps 1 and 2 above. It should already be immediately obvious how to do this but I'll describe it: to build the context, we will simply walk up the folder hierarchy, one folder at a time, which will build a reverse chronological series of "turns" (i.e. questions and answers) between the human and the AI. so for example, the immediate parent folder, of the current prompt file (which will be a `HUMAN.md`), will be expected to be a folder named "A{N}" (where {N} it's an integer we're an empty string), and its parent folder will be likewise, an "H{N}" named folder. and of course in each of these A or H (Agent or Human) folders you'll expect to find an "AI.md" or a "HUMAN.md" file. you'll keep walking up the folder tree, until you run into, a folder that doesn't have the expected file name matching one of the expected patterns, or until you run into a folder that doesn't have an "AI.md" or a "HUMAN.md" filed in it, and that's how you'll know you'll be at the beginning of the conversation thread, and so you will end your context gathering at that point. now remember, you'll need to be putting all those things in the proper order when building the chat history for Langchain/LangGraph, but I think it should be very obvious for you to know how to order those correctly. i think if you are adding them to the beginning of the array as an insert at the head of the array, as you walk up the tree, then you'll have everything in the correct order when you're done walking up the tree. So there's nothing complicated about what I'm telling you in step three , that you wouldn't have been able to already figure out on your own just from steps one and two. literally the only thing we're doing in step three is we're building a proper context for the "Ask AI" button.
 
# Step 4 (done)

The above three steps have already gotten this to a point where we can participate in conversations with the AI Agent! The next step is to make it easier to reply to an "AI.md" file, to continue the conversation. Since we already have an "Ask AI" button that appears on the `HUMAN.md` files, let's make that become a "Reply" button for the `AI.md` files. make the "Reply" button. Use the same color and styling. what the reply button will do when clicked, is it will create an "H" subfolder, and put are you filing it named `HUMAN.md` and then navigate the user over into that file and immediately begin editing the file. so that's very straightforward,and simple to create a new folder and put a file in it and kick off the editing, but the only tricky part is that you'll need to use the existing `findNextNumberedFolder` function to be sure you're grabbing a new folder name that is a folder that doesn't already exist. in other words, if you look at how that method is being used, you'll know that we first try to use a folder named "H", and if that folder exis then it tries "H1", then "H2", etc until it finds a folder. this is how we allow the user to be able to potentially reply multiple times to the same thing. you'll note that we're not doing anything related to the actual saving of the next human prompt, and the user would need to save their editing and then click "Ask AI" once they're finished. so we're not really altering any of the flow of the existing application other than simply adding a new button named "Reply" which keeps the user from having to manually create the folder in the file before they start entering their next prompt.

# Step 5 (done)

Now that we have the "Ask AI" button implemented on the header of the `MarkdownEntry.tsx` and we know that works well , we also need the ability to add that same button to the right of the "Save" button for the case when the CodeMirror editor is displaying (i.e. `isEditing=true`), and on a file where `isHumanFile=true`. what this new "Ask AI" button will do when it's clicked while the user is editing a file is that it will first run the existing save function, to save the file, and then it will run the `handleAskAi` function to do the AI inference. in other words, we're just creating a quick way for the user to be able to submit a prompt to the AI without them having to first save the file and then click another button to submit. this will be a much easier flow when the user is replying to the AI.

# Step 6 (done)

next we will create an easier way for the user to ask their first question in an AI conversation thread. in other words, a way to initiate an AI conversation . we currently have a tools icon at the top of the main browser view/tab, which opens up our `ToolsPopupMenu.tsx`. so let's add a new menu item to that Tools menu called `New AI Chat`. when the user clicks this new menu item, we'll use our `findNextNumberedFolder` function to find the next available "H" folder (H, H1, H2, etc), and then we'll create that folder, and then we'll create a new file in that folder named `HUMAN.md`, and then we'll navigate to that folder , and open that file for editing. this way anytime the user is browsing they can decide to branch off a new conversation thread right from the folder they're browsing , and we will initialize that and pop them into the location where they can type their first prompt.

# Step 7 (done)

We already have the configuration information for this application being stored in a config file named `config.yaml`, and we have a settings view named `SettingsView.tsx` where the user can configure a few settings that are then persisted into the config file. Let's add a new section to the settings view named "AI Settings", where we can let the user select from a simple drop-down combo box which option they want to use for their AI provider. so we'll need to create a simple object definition (or interface), that can hold three properties, which will be 1) `name` the text name we present to the user 2) `provider` the type of model AI_PROVIDER it is (ANTHROPIC | OLLAMA), and 3) `model` the actual model name itself (like `claude-3-haiku-20240307`). We will store the settings in memory as an array in a variable `aiModels` (which will be a top level property in the `config.yaml`). each element in this `aiModels` array will be an instance of the object of the type that I just described with the three properties I just described.

when loading the configs, we need to check if this array is missing , and if it's missing then populate it with the two different types of models and model providers that we have currently in `aiUtils.ts`, and put this logic in a method called `createDefaultAISettings`, which is a function we can call from the place where we load the config to ensure that it does have usable values. so we will also need another top level property named `aiModel` which will simply hold the name of the currently selected model, and you'll need to default that as well to the Claude model if it doesn't exist. so all these default settings would be added in when `createDefaultAISettings` is called. and don't forget to write out the new config file content if anything changes during the default settings call.

so that takes care of the data availability, and after you've done those changes, you can now populate the `SettingsView.tsx` combo box model selection combo box inside the "AI Settings" section of the settings view, by displaying the model names in the combo box , and of course, when the user selects an item in the combo box , you'll not only update the `aiModel` value in memory , but you'll also write out the config file to update that in the file. 

and of course the final step of this will be to make the changes in the `aiUtils.ts` module so that it uses the `aiModel` name to find the proper configuration object it matches that name , wish it will then use to initialize the LLM connection every time an AI inference is executed .

# Step 8 (done)

## Initial question to AI Planning Mode:
Next, we need to design a way for the user to specify which files from the current folder they would like to include in the AI prompt, when they click the "Ask AI" button. is there already a convention for this that AI agents are using, that would be some type of directive embedded into a prompt that would not be evaluated as prompt text but would be used for constructing the context for the prompt ? if there is a coding standard that has been established for either Github Copilot or Claude Code for this, then let me know what the standard is, but my first idea would be something like "/include all" which would be a line that we could allow the users to put as the last line in their prompt, which would trigger the system to include all of the files in the current folder into the conversation context somehow , and then of course the "/include all" would be stripped out of the text before it's embedded into the prompt itself.  

## Outcome/Decision
We designed the `#file:<pattern>` directive syntax, inspired by VSCode Copilot's `#file:` references. Directives must appear on their own line in a `HUMAN.md` file. The pattern supports simple wildcards (`*` matches any string). Examples: `#file:*` (all files), `#file:*.md` (all markdown files), `#file:notes.txt` (specific file). `HUMAN.md` is always excluded. Directive lines are stripped before sending the prompt, and matched file contents are appended in an `<attached_files>` XML block. Directives in historical conversation turns are also expanded.

## Implementation
- Created `src/ai/promptPreprocess.ts` — pure functions (`wildcardToRegex`, `preprocessPrompt`, `FILE_DIRECTIVE_REGEX`) with no Electron/LangChain dependencies, testable in plain Node.
- Updated `src/ai/aiUtil.ts` — re-exports from `promptPreprocess.ts`; `gatherConversationHistory` now expands `#file:` directives in historical HUMAN.md turns.
- Updated `src/main.ts` — the `ask-ai` handler calls `preprocessPrompt` on the current prompt before passing it to `invokeAI`.
- Created `tests/preprocess.test.ts` — 20 unit tests covering `wildcardToRegex`, `FILE_DIRECTIVE_REGEX`, and `preprocessPrompt`.

Prompt gets altered to include this:

```
User's prompt text here...

<attached_files>
<file path="notes.txt">
...content...
</file>
</attached_files>
```

# Step 9 (done)

We completed step 8 above, intentionally without considering the possibility for attaching images to our context. in step 9 (this step) we want to design a way to be able to send images to the AI. for now, we will leave it up to the user to be responsible for knowing whether their selected AI provider supports images or not, but for our initial testing, can you please recommend which Anthropic model would be the cheapest for us to use for testing purposes. for testing, we just want the simplest, cheapest model we can use that supports images. to be clear, I'm, of course, talking about image uploading, not image generation. we will be sending the image to the AI, and for the moment, we won't be considering any cases where the AI might send an image back to us (although that feature will  come later, in case it helps you to know that now). i'm pretty sure Langchain will already have the support for image uploading in their API, and as long as the model provider we're using supports images then everything should work smoothly. the way this will work is that we will simply detect when any of the attachment files that we're processing (per step 8 above), happen to be images, and if so, then rather than including those as "<attached_files>" we will be doing something different to add the images to the context in whatever way is done in the Langchain API.  

## Decisions
- **Same `#file:` directive**: auto-detects images by file extension (no separate `#image:` directive).
- **Current turn only**: Images are attached only for the current prompt; historical turns use `includeImages: false` to avoid re-sending costly image data.
- **SVGs as images**: SVG files are sent as `image/svg+xml` base64 data URLs (not as text attachments).
- **10 MB limit**: Per-image size cap via `MAX_IMAGE_SIZE_BYTES`; oversized files are skipped with a note in the prompt text.
- **Cheapest model**: Claude 3 Haiku (`claude-3-haiku-20240307`) — already the app's default — supports vision at $0.25/MTok input.

## Implementation
- Updated `src/ai/promptPreprocess.ts`:
  - Added `IMAGE_EXTENSIONS` set, `getImageMimeType()`, `isImageFile()`, `MAX_IMAGE_SIZE_BYTES` constant.
  - Added `ImageAttachment` and `PreprocessResult` interfaces.
  - Changed `preprocessPrompt()` return type from `string` to `PreprocessResult` (`{ text, images }`).
  - Image files matched by `#file:` are read as binary, base64-encoded, and returned in the `images` array.
  - Text files continue to go into the `<attached_files>` XML block in `text`.
  - Added `includeImages` parameter (default `true`); when `false`, image files are skipped entirely.
  - Images exceeding 10 MB are skipped with a note like `[Skipped image "file.png": exceeds 10 MB limit]`.
- Updated `src/ai/aiUtil.ts`:
  - Added `buildHumanMessage()` helper that creates a plain `HumanMessage` for text-only or a multimodal content-array `HumanMessage` with `image_url` parts for prompts with images.
  - Changed `invokeAI()` and `invokeAINonAgentic()` to accept `PreprocessResult` instead of `string`.
  - `gatherConversationHistory()` now passes `includeImages: false` for historical `HUMAN.md` turns.
  - Re-exports `PreprocessResult` and `ImageAttachment` types.
- Updated `src/main.ts` `ask-ai` handler — no signature change needed since `preprocessPrompt()` now returns `PreprocessResult` which is passed directly to `invokeAI()`.
- Updated `tests/preprocess.test.ts`:
  - All 10 existing tests adapted for `PreprocessResult` return type (accessing `.text` and `.images`).
  - Added 13 new tests: `getImageMimeType` (3), `isImageFile` (2), image handling (8) covering image separation, PNG/JPG/SVG attachment, base64 encoding, `includeImages: false`, oversized image skipping, and mixed text/image directives.
  - Replaced fake `image.png` text fixture with real tiny PNG and added `diagram.jpg` and `icon.svg` fixtures.
  - Total: 33 tests, all passing.

# Step 10 (done)

let's create a way for the user to Create, Edit, and Delete the AI model provider objects that we edit in the `SettingsView.tsx`. the way I'm thinking this could work is that we would have Create, Edit, and Delete buttons just to the right of the combo box where the user has selected one of the provider entries. obviously, the delete operation would be simple, and needs no design actually in terms of GUI, or how that would work because it's obvious how that would work. and for the create and edit buttons, it seems to me like maybe a dedicated pop-up dialogue would be best for that. you can look for a file named `SearchDialog.tsx` and follow that example for how to do the architecture and the styling of the dialogue, and copy as much of that approach as you find applicable to this new dialogue. you can make this new day a log be named `EditAIModel.tsx`. at the top of this dialogue we'll have a text entry field where the user can enter a name string. we will always save to this entry that they've entered for the name, and it's up to the user to know that if they replicate the name of an existing provider that they're essentially overriding and updating that provider. so this dialogue can be used for both the "Edit" and the "Create" button, and the only real difference is that when they click the "Edit" button, we will have defaulted the name and all the properties to be whatever they're currently editing . if they had click the Create button then we'll have an empty field for the name , as the default . so below the name edit field we'll have a drop-down combo box where we list the four types of providers that we have (Anthropic, OpenAI, etc), and then below that we'll have a text field where the user will be expected to enter the actual model name itself. 

RESULTS: AI generated `EditAIModeDialog.tsx`, and is calling it from settings view.