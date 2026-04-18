/**
 * AI utility functions for MkBrowser.
 * This module runs in the main process only — never import from the renderer.
 */
import { ChatAnthropic } from '@langchain/anthropic';
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
import { recordUsage } from './usageTracker';
import { ensureRunning } from '../llamaServer';
import { DEFAULT_AI_REWRITE_PERSONA, AI_REWRITE_PROMPT, AI_REWRITE_SELECTION_PROMPT } from './aiPrompts';
import { preprocessPrompt, type PreprocessResult } from './promptPreprocess';
import { USE_DEEP_AGENTS, invokeDeepAgent, streamDeepAgent } from './deepAgent';

export { preprocessPrompt, wildcardToRegex, FILE_DIRECTIVE_REGEX } from './promptPreprocess';
export type { PreprocessResult, ImageAttachment } from './promptPreprocess';
export { AI_FOLDER_REGEX, HUMAN_FOLDER_REGEX } from './aiPatterns';

// Set to true to enable verbose debug logging for AI invocations.
const DEBUG = true;

function debugLog(...args: unknown[]) {
  if (DEBUG) console.log('[aiUtil DEBUG]', ...args);
}

// NOTE: See 'llamacpp' folder for instructions on setting up llama.cpp for local inference.

/**
 * Resolve the active AI provider and model name from the config.
 * Falls back to Anthropic Claude Haiku if nothing is configured.
 */
export function getActiveModelConfig(): { provider: 'ANTHROPIC' | 'OPENAI' | 'GOOGLE' | 'LLAMACPP'; model: string; llamacppBaseUrl: string } {
  const config = getConfig();
  const llamacppBaseUrl = config.llamacppBaseUrl || 'http://localhost:8080/v1';

  const normalizeKey = (name: string) => name.trim().toLowerCase();

  if (config.aiModel && config.aiModels) {
    const selectedKey = normalizeKey(config.aiModel);
    const entry = config.aiModels.find((m) => normalizeKey(m.name) === selectedKey);
    if (entry) {
      debugLog('getActiveModelConfig → provider:', entry.provider, 'model:', entry.model);
      return { provider: entry.provider, model: entry.model, llamacppBaseUrl };
    }
  }

  // Fallback defaults
  debugLog('getActiveModelConfig → using fallback: ANTHROPIC / claude-3-haiku-20240307');
  return { provider: 'ANTHROPIC', model: 'claude-3-haiku-20240307', llamacppBaseUrl };
}

/**
 * Create the appropriate LangChain chat model based on the active config.
 */
export function createChatModel() {
  const { provider, model, llamacppBaseUrl } = getActiveModelConfig();
  debugLog('createChatModel → provider:', provider, 'model:', model);
  if (provider === 'LLAMACPP') {
    return new ChatOpenAI({ model, configuration: { baseURL: llamacppBaseUrl } });
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
export function buildHumanMessage(result: PreprocessResult): HumanMessage {
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

/** Result of an AI invocation: the text content plus optional token usage and thinking. */
export interface AIInvokeResult {
  content: string;
  thinking?: string;
  usage?: AIUsageInfo;
}

/**
 * Extract usage metadata from a LangChain AIMessage, if present.
 */
export function extractUsage(message: BaseMessage): AIUsageInfo | undefined {
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
 * Returns true if a scripted answer is currently queued.
 * Used by main.ts to bypass streaming when a test answer is pending.
 */
export function hasScriptedAnswer(): boolean {
  return scriptedAnswer !== null;
}

/**
 * AI invocation with optional tool support.
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
            () => reject(new Error(`AI model request timed out after ${MODEL_TIMEOUT_MS / 1000}s. The model may still be loading — try again in a moment.`)),
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
  const { provider, model: modelName } = getActiveModelConfig();
  debugLog('invokeAI → invoking graph with', history.length + 1, 'messages (prompt text length:', prompt.text.length, ', images:', prompt.images.length, ')');
  debugLog('invokeAI → provider:', provider, '| model:', modelName);
  try {
    const result = await graph.invoke({
      messages: [...history, humanMsg],
    });

    debugLog('invokeAI → graph finished successfully');
    const lastMessage = result.messages[result.messages.length - 1];

    let content = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);
    const usage = extractUsage(lastMessage);

    // Extract thinking content. Sources checked in order:
    // 1. additional_kwargs.reasoning_content (Anthropic, OpenAI o-series via LangChain)
    // 2. Inline <think>...</think> tags in content (llama.cpp with --reasoning-format none)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const additionalKwargs = (lastMessage as any).additional_kwargs ?? {};
    let thinking: string | undefined;
    const rawThinking = additionalKwargs.reasoning_content;
    if (typeof rawThinking === 'string' && rawThinking.length > 0) {
      thinking = rawThinking;
    } else {
      // Check for <think>...</think> tags in content (llama.cpp thinking models)
      const thinkMatch = content.match(/^<think>([\s\S]*?)<\/think>\s*/);
      if (thinkMatch) {
        thinking = thinkMatch[1].trim();
        content = content.slice(thinkMatch[0].length);
      }
    }

    debugLog('invokeAI → returning response, length:', content.length, 'thinking:', thinking ? thinking.length + ' chars' : 'none', 'usage:', usage);
    return { content, thinking, usage };
  } catch (err) {
    debugLog('invokeAI → ERROR during graph.invoke:', err);
    throw err;
  }
}

/** Callbacks for streaming AI responses. */
export interface StreamCallbacks {
  onChunk: (token: string) => void;
  onThinkingChunk: (token: string) => void;
  onToolCall: (toolName: string, summary: string) => void;
}

/**
 * Streaming AI invocation. Builds the same StateGraph as `invokeAI` but uses
 * `graph.streamEvents()` to emit token-level chunks, thinking tokens, and
 * tool call status lines via callbacks. Accumulates the full response and
 * returns the same `AIInvokeResult` as `invokeAI`.
 *
 * @param prompt   Preprocessed prompt (text + images).
 * @param history  Prior conversation messages.
 * @param callbacks  Streaming event callbacks.
 * @param signal   Optional AbortSignal for cancellation.
 */
export async function streamAI(
  prompt: PreprocessResult,
  history: BaseMessage[] = [],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<AIInvokeResult> {
  debugLog('streamAI → creating model');
  const model = createChatModel();

  const useTools = aiTools.length > 0 && getConfig().agenticMode;
  const boundModel = useTools ? model.bindTools(aiTools) : model;
  debugLog('streamAI → tools bound:', useTools, '(', aiTools.length, 'tools)');

  const builder = new StateGraph(MessagesAnnotation)
    .addNode('chat', async (state) => {
      debugLog('streamAI [graph:chat] → invoking model with', state.messages.length, 'messages');
      const response = await boundModel.invoke(state.messages, { signal });
      return { messages: [response] };
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
          debugLog('streamAI [router] → tool calls detected, routing to tools node');
          return 'tools';
        }
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

  let contentAccum = '';
  let thinkingAccum = '';
  let usage: AIUsageInfo | undefined;
  // Track whether we're inside a <think> block (llama.cpp inline thinking)
  let insideLlamacppThink = false;
  let pendingContent = '';

  debugLog('streamAI → starting streamEvents');
  try {
    const eventStream = graph.streamEvents(
      { messages: [...history, humanMsg] },
      { version: 'v2', signal },
    );

    for await (const event of eventStream) {
      // Token-level chunks from the chat model
      if (event.event === 'on_chat_model_stream') {
        const chunk = event.data?.chunk;
        if (!chunk) continue;

        // Check for thinking content in additional_kwargs (Anthropic, OpenAI o-series)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const additionalKwargs = (chunk as any).additional_kwargs ?? {};
        const reasoningContent = additionalKwargs.reasoning_content;
        if (typeof reasoningContent === 'string' && reasoningContent.length > 0) {
          thinkingAccum += reasoningContent;
          callbacks.onThinkingChunk(reasoningContent);
          continue;
        }

        // Extract text content from chunk
        let text = '';
        if (typeof chunk.content === 'string') {
          text = chunk.content;
        } else if (Array.isArray(chunk.content)) {
          for (const part of chunk.content) {
            if (part.type === 'text' && typeof part.text === 'string') {
              text += part.text;
            }
          }
        }

        if (text.length === 0) continue;

        // Handle llama.cpp inline <think>...</think> tags in streaming content
        pendingContent += text;

        // Process pending content for think tags
        while (pendingContent.length > 0) {
          if (insideLlamacppThink) {
            const closeIdx = pendingContent.indexOf('</think>');
            if (closeIdx !== -1) {
              // Emit everything before </think> as thinking
              const thinkText = pendingContent.slice(0, closeIdx);
              if (thinkText.length > 0) {
                thinkingAccum += thinkText;
                callbacks.onThinkingChunk(thinkText);
              }
              pendingContent = pendingContent.slice(closeIdx + '</think>'.length);
              insideLlamacppThink = false;
              // Skip any leading whitespace after </think>
              const trimmed = pendingContent.replace(/^\s+/, '');
              pendingContent = trimmed;
            } else {
              // Still inside think block, emit all as thinking
              thinkingAccum += pendingContent;
              callbacks.onThinkingChunk(pendingContent);
              pendingContent = '';
            }
          } else {
            const openIdx = pendingContent.indexOf('<think>');
            if (openIdx !== -1) {
              // Emit everything before <think> as content
              const beforeThink = pendingContent.slice(0, openIdx);
              if (beforeThink.length > 0) {
                contentAccum += beforeThink;
                callbacks.onChunk(beforeThink);
              }
              pendingContent = pendingContent.slice(openIdx + '<think>'.length);
              insideLlamacppThink = true;
            } else {
              // No think tags — emit as normal content
              contentAccum += pendingContent;
              callbacks.onChunk(pendingContent);
              pendingContent = '';
            }
          }
        }
      }

      // Tool call events — show a brief status line
      if (event.event === 'on_tool_start') {
        const toolName = event.name ?? 'unknown';
        // Build a brief summary from the input
        const input = event.data?.input;
        let summary = '';
        if (input && typeof input === 'object') {
          // Take the first string value as a brief summary
          const values = Object.values(input);
          const firstStr = values.find((v): v is string => typeof v === 'string');
          if (firstStr) {
            summary = firstStr.length > 60 ? firstStr.slice(0, 57) + '...' : firstStr;
          }
        } else if (typeof input === 'string') {
          summary = input.length > 60 ? input.slice(0, 57) + '...' : input;
        }
        debugLog('streamAI → tool call:', toolName, summary);
        callbacks.onToolCall(toolName, summary);
      }

      // Extract usage from final message
      if (event.event === 'on_chat_model_end') {
        const output = event.data?.output;
        if (output) {
          const extracted = extractUsage(output);
          if (extracted) usage = extracted;
        }
      }
    }

    debugLog('streamAI → stream completed, content length:', contentAccum.length,
      'thinking:', thinkingAccum.length > 0 ? thinkingAccum.length + ' chars' : 'none');
    return {
      content: contentAccum,
      thinking: thinkingAccum.length > 0 ? thinkingAccum : undefined,
      usage,
    };
  } catch (err) {
    // If aborted, return what we have so far
    if (signal?.aborted) {
      debugLog('streamAI → aborted by user, returning partial content (' + contentAccum.length + ' chars)');
      return {
        content: contentAccum,
        thinking: thinkingAccum.length > 0 ? thinkingAccum : undefined,
        usage,
      };
    }
    debugLog('streamAI → ERROR:', err);
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

/** Result of handleAskAI — either a success with paths and usage, or an error. */
export type AskAIResult =
  | { outputPath: string; responseFolder: string; usage?: AIUsageInfo }
  | { error: string };

/**
 * Orchestrate an AI prompt: preprocess, validate, invoke (streaming or not),
 * record usage, and write AI.md / THINK.md to disk.
 *
 * Electron-specific concerns (cancel listener, webContents.send) are handled
 * by the caller via `streamCallbacks` and `signal`.
 *
 * @param prompt            Raw prompt text from the user
 * @param parentFolderPath  Folder containing the H/ folder with HUMAN.md
 * @param streamCallbacks   If non-null, use streaming; null = non-streaming invoke
 * @param signal            Optional AbortSignal for cancellation
 * @param onStreamDone      Called when streaming finishes successfully
 * @param onStreamError     Called when streaming throws (before re-throw)
 */
export async function handleAskAI(
  prompt: string,
  parentFolderPath: string,
  streamCallbacks: StreamCallbacks | null,
  signal?: AbortSignal,
  onStreamDone?: () => void,
  onStreamError?: (err: unknown) => void,
): Promise<AskAIResult> {
  // Preprocess the prompt first (before creating folders) so we can
  // detect images and validate vision support before any side effects.
  const processedPrompt = await preprocessPrompt(prompt, parentFolderPath);

  // If the prompt contains images, verify the selected model supports vision
  if (processedPrompt.images.length > 0) {
    const config = getConfig();
    const activeModel = config.aiModels?.find((m) => m.name === config.aiModel);
    if (activeModel && !activeModel.vision) {
      return {
        error: `The selected model "${activeModel.name}" does not support images. Please select a vision-capable model or remove image files from your prompt.`,
      };
    }
  }

  // If using a LLAMACPP model, ensure the server is running before inference
  {
    const config = getConfig();
    const activeModel = config.aiModels?.find((m) => m.name === config.aiModel);
    if (activeModel?.provider === 'LLAMACPP') {
      await ensureRunning();
    }
  }

  // Find the next available response folder: A/, A1/, A2/, ...
  const responseFolder = await findNextNumberedFolder(parentFolderPath, 'A');

  // Create the response folder
  await fs.mkdir(responseFolder, { recursive: true });

  // Response always goes into AI.md inside the numbered folder
  const outputPath = path.join(responseFolder, 'AI.md');

  // Gather conversation history from the folder hierarchy
  const history = await gatherConversationHistory(parentFolderPath);

  let content: string;
  let thinking: string | undefined;
  let usage: AIUsageInfo | undefined;

  if (streamCallbacks && !hasScriptedAnswer()) {
    // ── Streaming path ──
    try {
      const result = USE_DEEP_AGENTS
        ? await streamDeepAgent(processedPrompt, history, streamCallbacks, signal)
        : await streamAI(processedPrompt, history, streamCallbacks, signal);
      content = result.content;
      thinking = result.thinking;
      usage = result.usage;

      // Handle cancellation: mark partial content
      if (signal?.aborted && content.length > 0) {
        content += '\n\n---\n*[Response interrupted by user]*';
      }

      onStreamDone?.();
    } catch (streamErr) {
      onStreamError?.(streamErr);
      throw streamErr;
    }

    // If aborted with no content, clean up the empty response folder
    if (signal?.aborted && content.length === 0) {
      try { await fs.rm(responseFolder, { recursive: true }); } catch { /* ignore */ }
      return { error: 'Response cancelled by user' };
    }
  } else {
    // ── Non-streaming path ──
    const result = USE_DEEP_AGENTS
      ? await invokeDeepAgent(processedPrompt, history)
      : await invokeAI(processedPrompt, history);
    content = result.content;
    thinking = result.thinking;
    usage = result.usage;
  }

  // Record token usage if available
  if (usage) {
    const config = getConfig();
    const activeModel = config.aiModels?.find((m) => m.name === config.aiModel);
    const provider = activeModel?.provider ?? 'ANTHROPIC';
    recordUsage(provider, usage.input_tokens, usage.output_tokens);
  }

  // Write the response
  await fs.writeFile(outputPath, content, 'utf-8');

  // Write thinking content (if any) to THINK.md alongside AI.md
  if (thinking && thinking.length > 0) {
    const thinkingPath = path.join(responseFolder, 'THINK.md');
    await fs.writeFile(thinkingPath, thinking, 'utf-8');
  }

  return { outputPath, responseFolder, usage };
}

/**
 * Rewrite content using the configured AI rewrite prompt.
 * Returns the rewritten text and optional usage info.
 */
export async function handleRewriteContent(
  content: string,
): Promise<{ rewrittenContent: string; usage?: AIUsageInfo } | { error: string }> {
  // If using a LLAMACPP model, ensure the server is running before inference
  const config = getConfig();
  const activeModel = config.aiModels?.find((m) => m.name === config.aiModel);
  if (activeModel?.provider === 'LLAMACPP') {
    await ensureRunning();
  }

  // Resolve the rewrite prompt template
  const selectedPromptName = config.aiRewritePrompt;
  const namedPrompt = selectedPromptName
    ? (config.aiRewritePrompts ?? []).find((p) => p.name === selectedPromptName)
    : undefined;
  const personaPart = namedPrompt?.prompt ?? DEFAULT_AI_REWRITE_PERSONA;

  const prompt = {
    text: `${personaPart} ${AI_REWRITE_PROMPT}\n\n<content>\n${content}\n</content>`,
    images: [] as never[],
    fileDirectivesFound: false,
  };

  const result = USE_DEEP_AGENTS
    ? await invokeDeepAgent(prompt)
    : await invokeAI(prompt);

  // Record token usage if available
  if (result.usage) {
    const provider = activeModel?.provider ?? 'ANTHROPIC';
    recordUsage(provider, result.usage.input_tokens, result.usage.output_tokens);
  }

  return { rewrittenContent: result.content, usage: result.usage };
}

/**
 * Rewrite a selected region of content using the configured AI rewrite prompt.
 * The full file content is sent for context, with <rewrite_region> tags marking the
 * portion to rewrite. The AI returns only the rewritten portion, which is spliced
 * back into the full content using the original character offsets.
 */
export async function handleRewriteContentSection(
  content: string,
  selectionFrom: number,
  selectionTo: number,
): Promise<{ rewrittenContent: string; usage?: AIUsageInfo } | { error: string }> {
  // If using a LLAMACPP model, ensure the server is running before inference
  const config = getConfig();
  const activeModel = config.aiModels?.find((m) => m.name === config.aiModel);
  if (activeModel?.provider === 'LLAMACPP') {
    await ensureRunning();
  }

  // Resolve the rewrite prompt template
  const selectedPromptName = config.aiRewritePrompt;
  const namedPrompt = selectedPromptName
    ? (config.aiRewritePrompts ?? []).find((p) => p.name === selectedPromptName)
    : undefined;
  const personaPart = namedPrompt?.prompt ?? DEFAULT_AI_REWRITE_PERSONA;

  // Build content with <rewrite_region> tags wrapping the selected portion
  const textWithSelection =
    content.slice(0, selectionFrom) +
    '<rewrite_region>' +
    content.slice(selectionFrom, selectionTo) +
    '</rewrite_region>' +
    content.slice(selectionTo);

  const prompt = {
    text: `${personaPart} ${AI_REWRITE_SELECTION_PROMPT}\n\n<content>\n${textWithSelection}\n</content>`,
    images: [] as never[],
    fileDirectivesFound: false,
  };

  const result = USE_DEEP_AGENTS
    ? await invokeDeepAgent(prompt)
    : await invokeAI(prompt);

  // Record token usage if available
  if (result.usage) {
    const provider = activeModel?.provider ?? 'ANTHROPIC';
    recordUsage(provider, result.usage.input_tokens, result.usage.output_tokens);
  }

  // Splice the rewritten portion back into the original content using offsets
  const rewrittenContent =
    content.slice(0, selectionFrom) +
    result.content +
    content.slice(selectionTo);

  return { rewrittenContent, usage: result.usage };
}

/**
 * Create a reply-to-AI folder with an empty HUMAN.md.
 * If createSubFolder is true, finds the next numbered H/ folder;
 * otherwise creates HUMAN.md directly in parentFolderPath.
 */
export async function handleReplyToAI(
  parentFolderPath: string,
  createSubFolder: boolean,
): Promise<{ folderPath: string; filePath: string } | { error: string }> {
  if (createSubFolder) {
    // Find the next available human folder: H/, H1/, H2/, ...
    const humanFolder = await findNextNumberedFolder(parentFolderPath, 'H');

    // Create the folder
    await fs.mkdir(humanFolder, { recursive: true });

    // Create an empty HUMAN.md inside it
    const filePath = path.join(humanFolder, 'HUMAN.md');
    await fs.writeFile(filePath, '', 'utf-8');

    return { folderPath: humanFolder, filePath };
  } else {
    // Create HUMAN.md directly in the parent folder
    const filePath = path.join(parentFolderPath, 'HUMAN.md');

    // Check if HUMAN.md already exists
    try {
      await fs.access(filePath);
      return { error: 'HUMAN.md already exists in this folder' };
    } catch {
      // File doesn't exist — proceed
    }

    await fs.writeFile(filePath, '', 'utf-8');
    return { folderPath: parentFolderPath, filePath };
  }
}

/** A single entry in an AI conversation thread. */
export interface ThreadEntry {
  role: 'human' | 'ai';
  folderPath: string;
  filePath: string;
  fileName: string;
  modifiedTime: number;
  createdTime: number;
}

/**
 * Walk up the H/A folder hierarchy from folderPath, collecting
 * HUMAN.md / AI.md entries in chronological (top-down) order.
 */
export async function gatherThreadEntries(
  folderPath: string,
): Promise<{ isThread: boolean; entries: ThreadEntry[] }> {
  // Check whether folderPath is part of a thread at all
  const humanFilePath = path.join(folderPath, 'HUMAN.md');
  const isHumanFolder = await fs.access(humanFilePath).then(() => true).catch(() => false);

  const aiFilePath = path.join(folderPath, 'AI.md');
  const isAIFolder = await fs.access(aiFilePath).then(() => true).catch(() => false);

  if (!isHumanFolder && !isAIFolder) {
    return { isThread: false, entries: [] };
  }

  const entries: ThreadEntry[] = [];
  let walker = folderPath;

  while (true) {
    const walkerHumanFile = path.join(walker, 'HUMAN.md');
    const walkerIsHuman = await fs.access(walkerHumanFile).then(() => true).catch(() => false);

    const walkerAiFile = path.join(walker, 'AI.md');
    const walkerIsAI = await fs.access(walkerAiFile).then(() => true).catch(() => false);

    if (walkerIsAI) {
      try {
        const stat = await fs.stat(walkerAiFile);
        entries.unshift({
          role: 'ai',
          folderPath: walker,
          filePath: walkerAiFile,
          fileName: 'AI.md',
          modifiedTime: stat.mtimeMs,
          createdTime: stat.birthtimeMs,
        });
      } catch {
        break;
      }
    } else if (walkerIsHuman) {
      try {
        const stat = await fs.stat(walkerHumanFile);
        entries.unshift({
          role: 'human',
          folderPath: walker,
          filePath: walkerHumanFile,
          fileName: 'HUMAN.md',
          modifiedTime: stat.mtimeMs,
          createdTime: stat.birthtimeMs,
        });
      } catch {
        break;
      }
    } else {
      break;
    }

    walker = path.dirname(walker);
  }

  return { isThread: true, entries };
}
