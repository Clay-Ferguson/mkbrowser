/**
 * AI utility functions for MkBrowser.
 * This module runs in the main process only — never import from the renderer.
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { fdir } from 'fdir';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Invoke the AI with a prompt and return the text response.
 * Optionally accepts prior conversation history to provide context.
 */
export async function invokeAI(prompt: string, history: BaseMessage[] = []): Promise<string> {
  const model = new ChatAnthropic({ model: 'claude-3-haiku-20240307' });

  const graph = new StateGraph(MessagesAnnotation)
    .addNode('chat', async (state) => {
      const response = await model.invoke(state.messages);
      return { messages: [response] };
    })
    .addEdge('__start__', 'chat')
    .addEdge('chat', '__end__')
    .compile();

  const result = await graph.invoke({
    messages: [...history, new HumanMessage(prompt)],
  });

  const lastMessage = result.messages[result.messages.length - 1];
  return typeof lastMessage.content === 'string'
    ? lastMessage.content
    : JSON.stringify(lastMessage.content);
}

/**
 * Find the first available folder name of the form `<baseName>`, `<baseName>1`,
 * `<baseName>2`, etc. inside `parentDir`. Uses fdir to scan existing subdirectory names.
 *
 * @param parentDir  Directory to scan for existing numbered subfolders.
 * @param baseName   Base folder name, e.g. "A".
 * @returns          Full absolute path for the first available folder.
 */
export async function findNextNumberedFolder(parentDir: string, baseName: string): Promise<string> {
  // Try bare baseName first (e.g. "A"), then "A1", "A2", ...
  const bare = path.join(parentDir, baseName);
  if (!existsSync(bare)) {
    return bare;
  }
  for (let i = 1; i <= 20; i++) {
    const candidate = path.join(parentDir, `${baseName}${i}`);
    if (!existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No available folder name found for "${baseName}" in "${parentDir}" (tried bare + 1–20)`);
}

/**
 * Find the first available filename of the form `<baseName>.md`, `<baseName>1.md`,
 * `<baseName>2.md`, etc. inside `dir`. Uses fdir to scan existing filenames.
 *
 * @param dir       Directory to scan (must already exist).
 * @param baseName  Base name without extension, e.g. "AI".
 * @returns         Full absolute path for the first available file.
 */
export async function findNextNumberedFile(dir: string, baseName: string): Promise<string> {
  let existingFiles: string[] = [];
  try {
    existingFiles = await new fdir()
      .withFullPaths()
      .withMaxDepth(0)
      .crawl(dir)
      .withPromise();
  } catch {
    // Directory might be empty or just created — treat as no existing files
  }

  const existingNames = new Set(existingFiles.map((f) => path.basename(f)));

  // Try <baseName>.md first, then <baseName>1.md, <baseName>2.md, ...
  const primaryName = `${baseName}.md`;
  if (!existingNames.has(primaryName)) {
    return path.join(dir, primaryName);
  }

  let counter = 1;
  for (;;) {
    const candidate = `${baseName}${counter}.md`;
    if (!existingNames.has(candidate)) {
      return path.join(dir, candidate);
    }
    counter++;
  }
}

/**
 * Walk up the folder hierarchy from the current HUMAN.md's parent folder to
 * gather all prior conversation turns. Folders starting with "H" are expected
 * to contain HUMAN.md; folders starting with "A" are expected to contain AI.md.
 * Walking stops at the first folder whose name doesn't match either pattern.
 *
 * Returns messages in chronological order (oldest first), ready to pass as
 * the `history` parameter to `invokeAI`.
 *
 * @param currentHumanFolder  Absolute path of the folder containing the
 *                            current HUMAN.md (the one the user clicked
 *                            "Ask AI" on). This folder itself is NOT included
 *                            in the history — its content is the new prompt.
 */
export async function gatherConversationHistory(
  currentHumanFolder: string
): Promise<BaseMessage[]> {
  const history: BaseMessage[] = [];

  // Start walking from the parent of the current H-folder
  let walker = path.dirname(currentHumanFolder);

  while (true) {
    const folderName = path.basename(walker);

    if (/^A\d*$/i.test(folderName)) {
      // Agent folder — look for AI.md
      const aiFile = path.join(walker, 'AI.md');
      try {
        const content = await fs.readFile(aiFile, 'utf-8');
        history.unshift(new AIMessage(content));
      } catch {
        // AI.md missing or unreadable — stop here
        break;
      }
    } else if (/^H\d*$/i.test(folderName)) {
      // Human folder — look for HUMAN.md
      const humanFile = path.join(walker, 'HUMAN.md');
      try {
        const content = await fs.readFile(humanFile, 'utf-8');
        history.unshift(new HumanMessage(content));
      } catch {
        // HUMAN.md missing or unreadable — stop here
        break;
      }
    } else {
      // Folder doesn't match H{N} or A{N} — we've reached the conversation root
      break;
    }

    // Move up one level
    walker = path.dirname(walker);
  }

  return history;
}
