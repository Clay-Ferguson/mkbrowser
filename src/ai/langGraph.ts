/**
 * LangGraph-based AI invocation for MkBrowser.
 * Provides `invokeAI` and `streamAI` using a StateGraph with optional tool calling.
 * This module runs in the main process only — never import from the renderer.
 */
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
// @ts-expect-error — moduleResolution "node" can't resolve subpath exports; works at runtime
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { aiTools } from './tools';
import { getConfig } from '../configMgr';
import { MKBROWSER_SYSTEM_PROMPT } from './aiPrompts';
import type { PreprocessResult } from './promptPreprocess';
import { createChatModel, getActiveModelConfig } from './aiModel';

// Set to true to enable verbose debug logging for AI invocations.
const DEBUG = true;

export function debugLog(...args: unknown[]) {
  if (DEBUG) console.log('[aiUtil DEBUG]', ...args);
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

/** Callbacks for streaming AI responses. */
export interface StreamCallbacks {
  onChunk: (token: string) => void;
  onThinkingChunk: (token: string) => void;
  onToolCall: (toolName: string, summary: string) => void;
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
      messages: [new SystemMessage(MKBROWSER_SYSTEM_PROMPT), ...history, humanMsg],
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
      { messages: [new SystemMessage(MKBROWSER_SYSTEM_PROMPT), ...history, humanMsg] },
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
