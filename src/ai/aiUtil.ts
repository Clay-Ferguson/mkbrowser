/**
 * AI utility functions for MkBrowser.
 * This module runs in the main process only — never import from the renderer.
 */
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
// @ts-expect-error — moduleResolution "node" can't resolve subpath exports; works at runtime
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { fdir } from 'fdir';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { aiTools } from './tools';
import { getConfig } from '../configMgr';
import { preprocessPrompt, type PreprocessResult } from './promptPreprocess';
import { AI_FOLDER_REGEX, HUMAN_FOLDER_REGEX } from '../utils/aiPatterns';

export { preprocessPrompt, wildcardToRegex, FILE_DIRECTIVE_REGEX } from './promptPreprocess';
export type { PreprocessResult, ImageAttachment } from './promptPreprocess';
export { AI_FOLDER_REGEX, HUMAN_FOLDER_REGEX } from '../utils/aiPatterns';

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

  const normalizeKey = (name: string) => name.trim().toLowerCase();

  if (config.aiModel && config.aiModels) {
    const selectedKey = normalizeKey(config.aiModel);
    const entry = config.aiModels.find((m) => normalizeKey(m.name) === selectedKey);
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
 * Single-slot scripted answer for Playwright demo tests.
 * When set, `invokeAI` returns this text (after a short delay) instead of
 * calling the real AI model. Cleared after each use.
 */
let scriptedAnswer: string | null = null;

/**
 * Queue a scripted answer that `invokeAI` will return on its next call
 * instead of invoking the real AI model. The slot is single-use: it resets
 * to `null` after being consumed. Intended for Playwright demo tests.
 */
export function queueScriptedAnswer(answer: string): void {
  debugLog('queueScriptedAnswer → queued', answer.length, 'chars');
  scriptedAnswer = answer;
}

/**
 * Non-agentic AI invocation with optional tool support.
 * Uses a StateGraph that sends messages to the model and, when tools are
 * enabled, loops back through a ToolNode to execute any tool calls the
 * model requests before producing a final text response.
 *
 * Optionally accepts prior conversation history to provide context.
 */
export async function invokeAI(prompt: PreprocessResult, history: BaseMessage[] = []): Promise<AIInvokeResult> {
  // Check for a scripted answer (queued by Playwright tests)
  if (scriptedAnswer !== null) {
    const answer = scriptedAnswer;
    scriptedAnswer = null;
    debugLog('invokeAI → returning scripted answer (' + answer.length + ' chars), sleeping 2s');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return { content: answer, usage: undefined };
  }

  debugLog('invokeAI → creating model');
  const model = createChatModel();

  const useTools = aiTools.length > 0 && getConfig().agenticMode;
  const boundModel = useTools ? model.bindTools(aiTools) : model;
  debugLog('invokeAI → tools bound:', useTools, '(', aiTools.length, 'tools)');

  // 3-minute hard timeout for a single model round-trip.  Ollama can silently
  // hang forever if the model is still loading or if tool-calling confuses it,
  // so we race against an explicit timeout and surface a clear error instead.
  const MODEL_TIMEOUT_MS = 3 * 60 * 1000;

  debugLog('invokeAI → building StateGraph (timeout:', MODEL_TIMEOUT_MS / 1000, 's, useTools:', useTools, ')');
  const builder = new StateGraph(MessagesAnnotation)
    .addNode('chat', async (state) => {
      debugLog('invokeAI [graph:chat] → invoking model with', state.messages.length, 'messages');
      debugLog('invokeAI [graph:chat] → first message role:', state.messages[0]?.constructor?.name ?? '?',
        '| useTools:', useTools, '| model type:', model.constructor?.name ?? '?');
      try {
        const invokePromise = boundModel.invoke(state.messages);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`AI model request timed out after ${MODEL_TIMEOUT_MS / 1000}s. Ollama may still be loading the model — try again in a moment.`)),
            MODEL_TIMEOUT_MS
          )
        );
        const response = await Promise.race([invokePromise, timeoutPromise]);
        debugLog('invokeAI [graph:chat] → model responded, content type:', typeof response.content,
          'length:', typeof response.content === 'string' ? response.content.length : JSON.stringify(response.content).length);
        return { messages: [response] };
      } catch (err) {
        debugLog('invokeAI [graph:chat] → ERROR during model.invoke:', err instanceof Error ? err.message : err);
        throw err;
      }
    });

  if (useTools) {
    const toolNode = new ToolNode(aiTools);
    builder
      .addNode('tools', toolNode)
      .addEdge('__start__', 'chat')
      .addConditionalEdges('chat', (state) => {
        const lastMsg = state.messages[state.messages.length - 1];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolCalls = (lastMsg as any).tool_calls;
        if (toolCalls && toolCalls.length > 0) {
          debugLog('invokeAI [router] → tool calls detected, routing to tools node');
          return 'tools';
        }
        debugLog('invokeAI [router] → no tool calls, finishing');
        return '__end__';
      })
      .addEdge('tools', 'chat');
  } else {
    builder
      .addEdge('__start__', 'chat')
      .addEdge('chat', '__end__');
  }

  const graph = builder.compile();

  const humanMsg = buildHumanMessage(prompt);
  const { provider, model: modelName, ollamaBaseUrl } = getActiveModelConfig();
  debugLog('invokeAI → invoking graph with', history.length + 1, 'messages (prompt text length:', prompt.text.length, ', images:', prompt.images.length, ')');
  debugLog('invokeAI → provider:', provider, '| model:', modelName, '| ollamaBaseUrl:', ollamaBaseUrl);
  try {
    const result = await graph.invoke({
      messages: [...history, humanMsg],
    });

    debugLog('invokeAI → graph finished successfully');
    const lastMessage = result.messages[result.messages.length - 1];
    const content = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);
    const usage = extractUsage(lastMessage);
    debugLog('invokeAI → returning response, length:', content.length, 'usage:', usage);
    return { content, usage };
  } catch (err) {
    debugLog('invokeAI → ERROR during graph.invoke:', err);
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
 * gather all prior conversation turns. Folders are expected
 * to contain HUMAN.md (if they're part of a thread), and the same is true for folders containing AI.md
 * Walking stops at the first folder whose name doesn't match either pattern.
 *
 * Returns messages in chronological order (oldest first), ready to pass as
 * the `history` parameter to `invokeAI` / `invokeAI`.
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

    const aiFileExists = existsSync(path.join(walker, 'AI.md'));
    const humanFileExists = existsSync(path.join(walker, 'HUMAN.md'));

    if (aiFileExists && humanFileExists) {
      // throw error to user saying there cannot be both files
      throw new Error(`Folder "${walker}" contains BOTH AI.md and HUMAN.md, which is unexpected. Please ensure each conversation turn folder contains only one of these files.`);
    }

    if (aiFileExists) {
      // Agent folder — look for AI.md
      const aiFile = path.join(walker, 'AI.md');
      try {
        const content = await fs.readFile(aiFile, 'utf-8');
        history.unshift(new AIMessage(content));
      } catch {
        // AI.md missing or unreadable — stop here
        break;
      }
    } else if (humanFileExists) {
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
