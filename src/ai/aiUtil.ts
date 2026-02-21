/**
 * AI utility functions for MkBrowser.
 * This module runs in the main process only — never import from the renderer.
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — TS moduleResolution:"node" can't resolve subpath exports; works at runtime
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { fdir } from 'fdir';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { aiTools } from './tools';

// NOTE: See 'ollama' folder for instructions on setting up a local Ollama server and 
// downloading/running the Qwen2.5 model.

/** Switch between 'ANTHROPIC' (cloud) and 'OLLAMA' (local) */
const AI_PROVIDER: 'ANTHROPIC' | 'OLLAMA' = 'OLLAMA';

// Set to true to use the ReAct agent with tools (Ollama only for now). Set to false to bypass the agent and call the model directly.
// When Agent Mode is being used use the Modelfile named `Modelfile-for-Agents`.
const AGENTIC_MODE = false;

/**
 * Invoke the AI with a prompt and return the text response.
 * Uses a ReAct agent (Ollama) that can call file-system tools (read_file,
 * list_directory) scoped to ~/. Falls back to the non-agentic path for
 * the Anthropic provider.
 *
 * Optionally accepts prior conversation history to provide context.
 */
export async function invokeAI(prompt: string, history: BaseMessage[] = []): Promise<string> {
  // Anthropic path — no tools wired up yet, use the simple non-agentic flow
  if (AI_PROVIDER === 'ANTHROPIC' || !AGENTIC_MODE) {
    return invokeAINonAgentic(prompt, history);
  }

  // Ollama path — ReAct agent with file-system tools
  const model = new ChatOllama({
    model: 'qwen-silent',
    baseUrl: 'http://localhost:11434',
  });

  const agent = createReactAgent({
    llm: model,
    tools: aiTools,
  });

  const result = await agent.invoke({
    messages: [...history, new HumanMessage(prompt)],
  });

  const lastMessage = result.messages[result.messages.length - 1];
  return typeof lastMessage.content === 'string'
    ? lastMessage.content
    : JSON.stringify(lastMessage.content);
}

/**
 * Non-agentic AI invocation (no tool calling). Kept as a simpler fallback.
 * Uses a single-node StateGraph that sends messages straight to the model.
 *
 * Optionally accepts prior conversation history to provide context.
 */
export async function invokeAINonAgentic(prompt: string, history: BaseMessage[] = []): Promise<string> {
  const model = AI_PROVIDER === 'OLLAMA'
    ? new ChatOllama({ 
      // if you have run the `ollama/setup.sh` then this model should work out of the box.
      //model: 'qwen2.5:7b', 

      // assuming that you had first run `ollama/setup.sh` (which is required), then you can run `ollama/configure.sh`
      // switch to our more customized model (defined in `ollama/Modelfile`) which has parameters geared towards limiting 
      // CPU usage memory consumption to have a good balance of power.
      // This model is based on `qwen2.5:7b`, but just has parametres controlling context window size and system prompt, etc.
      model: 'qwen-silent',

      baseUrl: 'http://localhost:11434' })
    : new ChatAnthropic({ model: 'claude-3-haiku-20240307' });

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
 * the `history` parameter to `invokeAI` / `invokeAINonAgentic`.
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
