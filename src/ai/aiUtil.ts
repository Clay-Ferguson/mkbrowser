/**
 * AI utility functions for MkBrowser.
 * This module runs in the main process only — never import from the renderer.
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { HumanMessage } from '@langchain/core/messages';
import { fdir } from 'fdir';
import path from 'node:path';

/**
 * Invoke the AI with a prompt and return the text response.
 */
export async function invokeAI(prompt: string): Promise<string> {
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
    messages: [new HumanMessage(prompt)],
  });

  const lastMessage = result.messages[result.messages.length - 1];
  return typeof lastMessage.content === 'string'
    ? lastMessage.content
    : JSON.stringify(lastMessage.content);
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
