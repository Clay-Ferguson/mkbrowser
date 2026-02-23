/**
 * AI utility functions for MkBrowser.
 * This module runs in the main process only — never import from the renderer.
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — TS moduleResolution:"node" can't resolve subpath exports; works at runtime
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { fdir } from 'fdir';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { aiTools, setToolsEnabled } from './tools';
import { getConfig } from '../configMgr';
import { preprocessPrompt, type PreprocessResult } from './promptPreprocess';

export { preprocessPrompt, wildcardToRegex, FILE_DIRECTIVE_REGEX } from './promptPreprocess';
export type { PreprocessResult, ImageAttachment } from './promptPreprocess';

/** Matches AI conversation folders: "A", "A1", "A2", etc. (case-sensitive) */
export const AI_FOLDER_REGEX = /^A\d*$/;
/** Matches Human conversation folders: "H", "H1", "H2", etc. (case-sensitive) */
export const HUMAN_FOLDER_REGEX = /^H\d*$/;

// Set to true to enable verbose debug logging for AI invocations.
const DEBUG = true;

function debugLog(...args: unknown[]) {
  if (DEBUG) console.log('[aiUtil DEBUG]', ...args);
}

// NOTE: See 'ollama' folder for instructions on setting up a local Ollama server and 
// downloading/running the Qwen2.5 model.

/**
 * Resolve the active AI provider and model name from the config.
 * Falls back to Anthropic Claude Haiku if nothing is configured.
 */
function getActiveModelConfig(): { provider: 'ANTHROPIC' | 'OLLAMA' | 'OPENAI' | 'GOOGLE'; model: string; ollamaBaseUrl: string } {
  const config = getConfig();
  const ollamaBaseUrl = config.ollamaBaseUrl || 'http://localhost:11434';

  if (config.aiModel && config.aiModels) {
    const entry = config.aiModels.find((m) => m.name === config.aiModel);
    if (entry) {
      debugLog('getActiveModelConfig → provider:', entry.provider, 'model:', entry.model);
      return { provider: entry.provider, model: entry.model, ollamaBaseUrl };
    }
  }

  // Fallback defaults
  debugLog('getActiveModelConfig → using fallback: ANTHROPIC / claude-3-haiku-20240307');
  return { provider: 'ANTHROPIC', model: 'claude-3-haiku-20240307', ollamaBaseUrl };
}

/**
 * Create the appropriate LangChain chat model based on the active config.
 */
function createChatModel() {
  const { provider, model, ollamaBaseUrl } = getActiveModelConfig();
  debugLog('createChatModel → provider:', provider, 'model:', model);
  if (provider === 'OLLAMA') {
    return new ChatOllama({ model, baseUrl: ollamaBaseUrl });
  }
  if (provider === 'OPENAI') {
    return new ChatOpenAI({ model });
  }
  if (provider === 'GOOGLE') {
    const apiKey = process.env.GOOGLE_API_KEY;
    debugLog('createChatModel → GOOGLE_API_KEY is', apiKey ? `set (${apiKey.length} chars)` : 'NOT SET — this will likely cause a hang or error');
    // maxRetries: 2 to fail faster on quota/auth errors instead of silently retrying many times
    return new ChatGoogleGenerativeAI({ model, maxRetries: 2 });
  }
  return new ChatAnthropic({ model });
}

/**
 * Build a HumanMessage from a PreprocessResult. When the result contains
 * images the message uses LangChain's multimodal content-array format;
 * otherwise it's a plain text message.
 */
function buildHumanMessage(result: PreprocessResult): HumanMessage {
  if (result.images.length === 0) {
    return new HumanMessage(result.text);
  }

  // Multimodal content array: text first, then image_url parts
  const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
    { type: 'text', text: result.text },
  ];

  for (const img of result.images) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${img.mimeType};base64,${img.base64Data}` },
    });
  }

  return new HumanMessage({ content });
}

/** Token usage metadata returned alongside AI responses. */
export interface AIUsageInfo {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/** Result of an AI invocation: the text content plus optional token usage. */
export interface AIInvokeResult {
  content: string;
  usage?: AIUsageInfo;
}

/**
 * Extract usage metadata from a LangChain AIMessage, if present.
 */
function extractUsage(message: BaseMessage): AIUsageInfo | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = (message as any).usage_metadata;
  if (meta && typeof meta.input_tokens === 'number') {
    return {
      input_tokens: meta.input_tokens,
      output_tokens: meta.output_tokens ?? 0,
      total_tokens: meta.total_tokens ?? (meta.input_tokens + (meta.output_tokens ?? 0)),
    };
  }
  return undefined;
}

/**
 * Invoke the AI with a preprocessed prompt and return the text response.
 * Uses a ReAct agent (Ollama) that can call file-system tools (read_file,
 * list_directory) scoped to ~/. Falls back to the non-agentic path for
 * the Anthropic provider.
 *
 * The prompt may include image attachments which are sent as multimodal
 * content parts when the model supports vision.
 *
 * Optionally accepts prior conversation history to provide context.
 */
export async function invokeAI(prompt: PreprocessResult, history: BaseMessage[] = []): Promise<AIInvokeResult> {
  const { provider } = getActiveModelConfig();
  const agenticMode = getConfig().agenticMode ?? false;
  setToolsEnabled(agenticMode);
  debugLog('invokeAI called — provider:', provider, 'agenticMode:', agenticMode, 'history length:', history.length);

  if (!agenticMode) {
    debugLog('invokeAI → routing to invokeAINonAgentic');
    return invokeAINonAgentic(prompt, history);
  }

  // Ollama path — ReAct agent with file-system tools
  debugLog('invokeAI → creating agentic model');
  const model = createChatModel();

  debugLog('invokeAI → creating ReAct agent');
  const agent = createReactAgent({
    llm: model,
    tools: aiTools,
  });

  const humanMsg = buildHumanMessage(prompt);
  debugLog('invokeAI → invoking agent with', history.length + 1, 'messages');
  const result = await agent.invoke({
    messages: [...history, humanMsg],
  });

  debugLog('invokeAI → agent finished, extracting response');
  const lastMessage = result.messages[result.messages.length - 1];
  const content = typeof lastMessage.content === 'string'
    ? lastMessage.content
    : JSON.stringify(lastMessage.content);
  const usage = extractUsage(lastMessage);
  debugLog('invokeAI → usage:', usage);
  return { content, usage };
}

/**
 * Non-agentic AI invocation (no tool calling). Kept as a simpler fallback.
 * Uses a single-node StateGraph that sends messages straight to the model.
 *
 * Optionally accepts prior conversation history to provide context.
 */
export async function invokeAINonAgentic(prompt: PreprocessResult, history: BaseMessage[] = []): Promise<AIInvokeResult> {
  debugLog('invokeAINonAgentic → creating model');
  const model = createChatModel();

  debugLog('invokeAINonAgentic → building StateGraph');
  const graph = new StateGraph(MessagesAnnotation)
    .addNode('chat', async (state) => {
      debugLog('invokeAINonAgentic [graph:chat] → invoking model with', state.messages.length, 'messages');
      try {
        const response = await model.invoke(state.messages);
        debugLog('invokeAINonAgentic [graph:chat] → model responded, content type:', typeof response.content,
          'length:', typeof response.content === 'string' ? response.content.length : JSON.stringify(response.content).length);
        return { messages: [response] };
      } catch (err) {
        debugLog('invokeAINonAgentic [graph:chat] → ERROR during model.invoke:', err);
        throw err;
      }
    })
    .addEdge('__start__', 'chat')
    .addEdge('chat', '__end__')
    .compile();

  const humanMsg = buildHumanMessage(prompt);
  debugLog('invokeAINonAgentic → invoking graph with', history.length + 1, 'messages (prompt text length:', prompt.text.length, ', images:', prompt.images.length, ')');
  try {
    const result = await graph.invoke({
      messages: [...history, humanMsg],
    });

    debugLog('invokeAINonAgentic → graph finished successfully');
    const lastMessage = result.messages[result.messages.length - 1];
    const content = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);
    const usage = extractUsage(lastMessage);
    debugLog('invokeAINonAgentic → returning response, length:', content.length, 'usage:', usage);
    return { content, usage };
  } catch (err) {
    debugLog('invokeAINonAgentic → ERROR during graph.invoke:', err);
    throw err;
  }
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

    if (AI_FOLDER_REGEX.test(folderName)) {
      // Agent folder — look for AI.md
      const aiFile = path.join(walker, 'AI.md');
      try {
        const content = await fs.readFile(aiFile, 'utf-8');
        history.unshift(new AIMessage(content));
      } catch {
        // AI.md missing or unreadable — stop here
        break;
      }
    } else if (HUMAN_FOLDER_REGEX.test(folderName)) {
      // Human folder — look for HUMAN.md
      const humanFile = path.join(walker, 'HUMAN.md');
      try {
        const rawContent = await fs.readFile(humanFile, 'utf-8');
        // Historical turns: includeImages=false to avoid re-sending costly images
        const processed = await preprocessPrompt(rawContent, walker, false);
        history.unshift(new HumanMessage(processed.text));
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
