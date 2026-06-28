/**
 * LangGraph-based AI invocation for MkBrowser.
 * Provides `invokeAI` and `streamAI` using a StateGraph with optional tool calling.
 * This module runs in the main process only — never import from the renderer.
 */
import { StateGraph, MessagesAnnotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import { aiTools } from './tools';
import { getConfig } from '../../configMgr';
import { buildSystemPrompt } from '../../shared/ai/aiPrompts';
import type { PreprocessResult } from './promptPreprocess';
import { createChatModel, getActiveModelConfig } from './aiModel';
import { consumeScriptedAnswer, queueScriptedAnswer, hasScriptedAnswer } from './scriptedAnswer';
import { getReasoningContent, getUsageMetadata, hasToolCalls } from './messageUtil';
import { StreamProcessor } from '../../main/ai/streamProcessor';
import { createDebugLog } from './aiLog';
export { queueScriptedAnswer, hasScriptedAnswer };

const debugLog = createDebugLog('langGraph');

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

/**
 * Resolve the user's currently-selected persona prompt from config.
 *
 * Personas are stored as `aiRewritePrompts` (an array of {name, prompt}) with
 * the active one named by `aiRewritePrompt`. Returns the persona's prompt text,
 * or undefined when none is selected (so callers can fall back as appropriate).
 */
export function resolveActivePersona(): string | undefined {
  const config = getConfig();
  const selectedPromptName = config.aiRewritePrompt;
  if (!selectedPromptName) return undefined;
  const namedPrompt = (config.aiRewritePrompts ?? []).find((p) => p.name === selectedPromptName);
  return namedPrompt?.prompt;
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
  const meta = getUsageMetadata(message);
  if (!meta) return undefined;
  return {
    input_tokens: meta.input_tokens,
    output_tokens: meta.output_tokens ?? 0,
    total_tokens: meta.total_tokens ?? (meta.input_tokens + (meta.output_tokens ?? 0)),
  };
}


/** Callbacks for streaming AI responses. */
export interface StreamCallbacks {
  onChunk: (token: string) => void;
  onThinkingChunk: (token: string) => void;
  onToolCall: (toolName: string, summary: string) => void;
}

/** State shape for the chat StateGraph (LangChain's MessagesAnnotation). */
type ChatGraphState = typeof MessagesAnnotation.State;

/** The chat node: invokes the model and returns the messages to append. */
type ChatNode = (state: ChatGraphState) => Promise<{ messages: BaseMessage[] }>;

/**
 * Build and compile the chat StateGraph shared by {@link invokeAI} and
 * {@link streamAI}.
 *
 * Both paths use an identical topology — a single `chat` node plus, when tools
 * are enabled, a `tools` ToolNode that the model loops back through until it
 * stops requesting tool calls. The only difference is *how* the chat node
 * invokes the model (timeout race vs abort signal), so that is injected as
 * `chatNode`.
 */
function buildChatGraph(useTools: boolean, chatNode: ChatNode) {
  const builder = new StateGraph(MessagesAnnotation).addNode('chat', chatNode);

  if (useTools) {
    const toolNode = new ToolNode(aiTools);
    builder
      .addNode('tools', toolNode)
      .addEdge('__start__', 'chat')
      .addConditionalEdges('chat', (state) => {
        const lastMsg = state.messages[state.messages.length - 1];
        if (hasToolCalls(lastMsg)) {
          debugLog('[router] → tool calls detected, routing to tools node');
          return 'tools';
        }
        debugLog('[router] → no tool calls, finishing');
        return '__end__';
      })
      .addEdge('tools', 'chat');
  } else {
    builder
      .addEdge('__start__', 'chat')
      .addEdge('chat', '__end__');
  }

  return builder.compile();
}

/**
 * AI invocation with optional tool support.
 * Uses a StateGraph that sends messages to the model and, when tools are
 * enabled, loops back through a ToolNode to execute any tool calls the
 * model requests before producing a final text response.
 *
 * Optionally accepts prior conversation history to provide context.
 *
 * @param persona  Resolved persona prompt to weave into the system prompt, or
 *                 undefined for the base system prompt with no persona.
 */
export async function invokeAI(prompt: PreprocessResult, history: BaseMessage[] = [], persona?: string): Promise<AIInvokeResult> {
  // Check for a scripted answer (queued by Playwright tests)
  const scriptedAnswer = consumeScriptedAnswer();
  if (scriptedAnswer !== null) {
    debugLog('invokeAI → returning scripted answer (' + scriptedAnswer.length + ' chars), sleeping 2s');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return { content: scriptedAnswer, usage: undefined };
  }

  debugLog('invokeAI → creating model');
  const model = createChatModel();

  const useTools = aiTools.length > 0 && Boolean(getConfig().agenticMode);
  const boundModel = useTools ? model.bindTools(aiTools) : model;
  debugLog('invokeAI → tools bound:', useTools, '(', aiTools.length, 'tools)');

  // 3-minute hard timeout for a single model round-trip.  llama.cpp can silently
  // hang forever if the model is still loading or if tool-calling confuses it,
  // so we race against an explicit timeout and surface a clear error instead.
  const MODEL_TIMEOUT_MS = 3 * 60 * 1000;

  debugLog('invokeAI → building StateGraph (timeout:', MODEL_TIMEOUT_MS / 1000, 's, useTools:', useTools, ')');
  const graph = buildChatGraph(useTools, async (state) => {
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

  const humanMsg = buildHumanMessage(prompt);
  const { provider, model: modelName } = getActiveModelConfig();
  debugLog('invokeAI → invoking graph with', history.length + 1, 'messages (prompt text length:', prompt.text.length, ', images:', prompt.images.length, ')');
  debugLog('invokeAI → provider:', provider, '| model:', modelName);
  try {
    const result = await graph.invoke({
      messages: [new SystemMessage(buildSystemPrompt(persona)), ...history, humanMsg],
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
    let thinking = getReasoningContent(lastMessage);
    if (!thinking) {
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
 * @param persona  Resolved persona prompt to weave into the system prompt, or
 *                 undefined for the base system prompt with no persona.
 */
export async function streamAI(
  prompt: PreprocessResult,
  history: BaseMessage[] = [],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  persona?: string,
): Promise<AIInvokeResult> {
  debugLog('streamAI → creating model');
  const model = createChatModel();

  const useTools = aiTools.length > 0 && Boolean(getConfig().agenticMode);
  const boundModel = useTools ? model.bindTools(aiTools) : model;
  debugLog('streamAI → tools bound:', useTools, '(', aiTools.length, 'tools)');

  const graph = buildChatGraph(useTools, async (state) => {
    debugLog('streamAI [graph:chat] → invoking model with', state.messages.length, 'messages');
    const response = await boundModel.invoke(state.messages, { signal });
    return { messages: [response] };
  });

  const humanMsg = buildHumanMessage(prompt);

  const processor = new StreamProcessor(callbacks);

  debugLog('streamAI → starting streamEvents');
  try {
    const eventStream = graph.streamEvents(
      { messages: [new SystemMessage(buildSystemPrompt(persona)), ...history, humanMsg] },
      { version: 'v2', signal },
    );

    for await (const event of eventStream) {
      processor.handleEvent(event);
    }

    const result = processor.finish();
    debugLog('streamAI → stream completed, content length:', result.content.length,
      'thinking:', result.thinking ? result.thinking.length + ' chars' : 'none');
    return result;
  } catch (err) {
    // If aborted, return what we have so far
    if (signal?.aborted) {
      const result = processor.finish();
      debugLog('streamAI → aborted by user, returning partial content (' + result.content.length + ' chars)');
      return result;
    }
    debugLog('streamAI → ERROR:', err);
    throw err;
  }
}
