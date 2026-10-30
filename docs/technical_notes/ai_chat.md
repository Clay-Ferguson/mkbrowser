# AI Chat Feature

<!-- TOC -->

* [Overview](#overview)
* [Folder Layout of a Conversation](#folder-layout-of-a-conversation)
* [Starting a Conversation](#starting-a-conversation)
* [Asking the AI](#asking-the-ai)
  * [What gets sent to the model](#what-gets-sent-to-the-model)
  * [Where the response goes](#where-the-response-goes)
* [Replying to the AI](#replying-to-the-ai)
* [The AI Chat Tab (`ThreadView`)](#the-ai-chat-tab-threadview)
  * [When the tab appears](#when-the-tab-appears)
  * [How the thread is gathered](#how-the-thread-is-gathered)
  * [What the view shows](#what-the-view-shows)
* [Code Map](#code-map)

<!-- /TOC -->

## Overview

As mentioned in the `docs/user_guide/USER_GUIDE.md` this application lets users have conversational chats with AI agents. We use a file naming convention to be able to use the file system as the storage format for the entire conversation thread between a human and an AI. The human enters their prompt in a file named `HUMAN.md`, and the AI responds by creating a file named `AI.md` to hold its response. (These names are the `HUMAN_FILENAME` and `AI_FILENAME` constants in `src/shared/specialFiles.ts`.)

All of the AI chat buttons and menu items only appear when AI is turned on ("Enable AI" in AI Settings, the `aiEnabled` config field).

## Folder Layout of a Conversation

Each turn of the conversation lives in its own folder, and every new turn is a subfolder of the previous one. AI turns go in folders named `A` and human turns in folders named `H`, so a conversation ends up looking like this:

```
my-chat/HUMAN.md              <- first prompt (lives directly in the folder the chat was started in)
my-chat/A/AI.md               <- first response
my-chat/A/H/HUMAN.md          <- second prompt
my-chat/A/H/A/AI.md           <- second response
...
```

We use very short folder names so that the path can get very deep, and the conversation very long, without running into path-length limits.

Each turn folder must contain exactly one of `HUMAN.md` or `AI.md` — a folder containing both is treated as an error when the conversation history is gathered. An AI turn folder may also contain a `THINK.md` file holding the model's "thinking" output, when the model produced any.

Folder names can carry a numeric suffix (`A1`, `A2`, `H1`, …). These appear when more than one turn is created under the same parent — for example, clicking "Ask AI" a second time on the same `HUMAN.md` creates `A1/` next to the existing `A/`. That is how a conversation **forks** into branches. The patterns are `AI_FOLDER_REGEX` (`/^A\d*$/`) and `HUMAN_FOLDER_REGEX` (`/^H\d*$/`) in `src/shared/ai/aiPatterns.ts`, and the next free name is picked by `findNextNumberedFolder()` in `src/main/ai/aiUtil.ts`.

## Starting a Conversation

There are two ways to begin a new conversation thread:

1. **Tools menu → "New AI Chat"** in the Browse View toolbar. This calls `startAiChat()` (`src/renderer/aiChatOp.ts`), which creates an empty `HUMAN.md` directly in the folder currently being browsed (no `H/` subfolder), switches to the AI Chat tab, and opens the new file in the editor. It refuses if the current folder already contains a `HUMAN.md`.
2. **Manually** create a file named `HUMAN.md` in any folder and edit it. The "Ask AI" button works the same way regardless of how the file was created.

## Asking the AI

Whenever a `HUMAN.md` file is being edited, an **"Ask AI"** button appears in the editor toolbar (rendered by `MarkdownEntry.tsx`). Clicking it saves the file and sends its content to the AI. The editor deliberately stays open while the response streams in and is closed only once the answer has arrived (and only if the save succeeded), together with the navigation to the response folder. This works the same in the Browse View and in the AI Chat tab.

While the response is being generated, a streaming dialog shows the tokens (plus any thinking output and tool calls, in agentic mode) as they arrive, and lets the user cancel. On cancel, any partial response is still saved with an `*[Response interrupted by user]*` marker appended; if nothing had arrived yet, the empty response folder is removed instead.

The request goes through the `ask-ai` IPC handler in `src/main.ts`, which calls `handleAskAI()` in `src/main/ai/aiUtil.ts`.

### What gets sent to the model

- **The prompt** is the `HUMAN.md` content after `preprocessPrompt()` (`src/main/ai/promptPreprocess.ts`) has expanded any `#file:<pattern>` directives. Each directive must be on its own line and is matched (with `*` wildcards) against the files in the same folder as the `HUMAN.md`. Text files are appended to the prompt in an `<attached_files>` block, and image files are attached as images (which requires a vision-capable model — the request is rejected up front otherwise).
- **The conversation history** comes from `gatherConversationHistory()`, which starts at the parent of the folder holding the current `HUMAN.md` and walks *up* the tree, collecting each `AI.md` / `HUMAN.md` until it reaches a folder that contains neither. Earlier human turns are run through the same `#file:` preprocessing, but without images, so they aren't re-sent on every turn.
- **The persona** currently selected (see the AI Chat tab's "Chat with Persona" box below, which is the same setting used by AI Rewrite) is woven into the system prompt.
- If **agentic mode** is enabled in AI Settings (`agenticMode`), the request runs through the deep agent (`src/main/ai/deepAgent.ts`), which can call tools; otherwise it is a plain LLM call (`src/main/ai/langGraph.ts`).

### Where the response goes

The response is written to `AI.md` in a new `A` folder created under the folder containing the `HUMAN.md` — i.e. `./A/AI.md`, or `./A1/AI.md`, `./A2/AI.md`, … if `A` already exists. Any thinking output is written to `THINK.md` next to it, and token usage is recorded by the usage tracker. The app then navigates to the new response folder (staying in the AI Chat tab and scrolling to the bottom if that's where the request came from).

## Replying to the AI

When an `AI.md` file is displayed (not being edited), it shows a **"Reply"** button. Clicking it calls `handleReplyToAI()` (via the `reply-to-ai` IPC handler), which creates a new `H` folder (or `H1`, `H2`, …) under the AI turn's folder containing an empty `HUMAN.md`, then navigates there and opens the new file for editing so the user can type the next prompt and click "Ask AI".

## The AI Chat Tab (`ThreadView`)

The whole conversation can be carried out within the standard Browse View (`BrowseView.tsx`), which is used for browsing all markdown files and folders. But there is also an **"AI Chat"** tab, which presents a more conventional chatbot user interface: the entire history of the conversation shown as a vertical list, chronologically from top to bottom. This view is implemented in `ThreadView.tsx` (`src/components/views/`).

### When the tab appears

The tab is shown (see `AppTabButtons.tsx`) whenever the folder currently being browsed directly contains a `HUMAN.md` or `AI.md` file (`isAiThreadByEntries()` in `src/shared/ai/aiPatterns.ts`), and also stays visible while the AI Chat tab itself is the active view.

### How the thread is gathered

The thread is always built relative to the folder currently shown in the Browse View, by `gatherThreadEntries()` in `src/main/ai/aiUtil.ts` (reached over the `gather-thread-entries` IPC call). If that folder has neither a `HUMAN.md` nor an `AI.md`, it isn't a thread and the view just says "Not an AI Thread".

- The history *before* (and including) that folder comes from walking up the parent folders for as long as each one contains an `AI.md` or `HUMAN.md`. The walk also stops when it would add two `HUMAN.md` turns in a row, since that means it has gone past the top of the conversation.
- The history *after* that folder comes from drilling down into `A*`/`H*` subfolders for as long as there is exactly one such subfolder at each level.
- When a folder contains multiple `A*`/`H*` subfolders the conversation has forked, so the drill-down stops there and the branch folders are listed as clickable items letting the user choose which branch to follow. (A branch folder that has no turn file in it also stops the drill-down and is listed the same way.) Each listed folder shows a short preview of its turn — the first 120 characters of its `HUMAN.md` or `AI.md`, read by `readAiHint()` in `src/main/ai/aiHint.ts`. Clicking one navigates into it while staying in the AI Chat tab.

### What the view shows

- Each turn is a fully interactive `MarkdownEntry` (so turns can be edited, renamed, deleted, etc. right in the thread), with an avatar and a colored left border: blue for human turns, green for AI turns.
- The turn belonging to the folder the Browse View is focused on is drawn with a purple border, so it's easy to see where you are in the conversation.
- Each turn has a "Show in Browse View" button that jumps to that file in the Browse View.
- The header holds a breadcrumb of the current path (clicking it navigates in the Browse View) and a **"Chat with Persona"** combobox for choosing which persona the AI uses. Personas are created in AI Settings; this box only selects one, and the choice is saved as the same `aiRewritePrompt` setting that AI Rewrite uses.

## Code Map

| Piece | Where |
|-------|-------|
| File/folder naming constants and patterns | `src/shared/specialFiles.ts`, `src/shared/ai/aiPatterns.ts` |
| "New AI Chat" menu item | `src/components/menus/ToolsPopupMenu.tsx` → `startAiChat()` in `src/renderer/aiChatOp.ts` |
| "Ask AI" and "Reply" buttons | `src/components/entries/MarkdownEntry.tsx` |
| IPC handlers (`ask-ai`, `reply-to-ai`, `gather-thread-entries`, `ai-stream-*`) | `src/main.ts`, `src/preload.ts` |
| Ask / reply / thread gathering logic | `handleAskAI()`, `gatherConversationHistory()`, `handleReplyToAI()`, `gatherThreadEntries()` in `src/main/ai/aiUtil.ts` |
| `#file:` directive and image handling | `src/main/ai/promptPreprocess.ts` |
| Branch-folder preview snippets | `src/main/ai/aiHint.ts` |
| AI Chat tab | `src/components/views/ThreadView.tsx`, tab visibility in `src/components/AppTabButtons.tsx` |
