/**
 * Deep Agents integration for MkBrowser.
 *
 * Provides an alternative AI invocation path using the `deepagents` package
 * (https://github.com/langchain-ai/deepagentsjs) alongside the existing
 * hand-built StateGraph in aiUtil.ts.
 *
 * Deep Agents is an "agent harness" built on LangGraph that adds:
 *   - Planning via a write_todos tool (task decomposition / progress tracking)
 *   - Virtual filesystem tools (read_file, write_file, ls, etc.) on an
 *     ephemeral in-memory StateBackend — these CANNOT access the real filesystem
 *   - Sub-agent spawning via a task tool
 *   - Auto-summarization for long conversations
 *
 * Security note: With the default StateBackend (used here), all built-in
 * filesystem tools operate on an in-memory virtual filesystem only.  No sandbox
 * backend is configured, so there is no `execute` tool and no shell access.
 *
 * This module runs in the main process only — never import from the renderer.
 */
import { createDeepAgent } from 'deepagents';
import type { BaseMessage } from '@langchain/core/messages';
import {
  createChatModel,
  buildHumanMessage,
  extractUsage,
  getActiveModelConfig,
  type AIInvokeResult,
  type AIUsageInfo,
  type StreamCallbacks,
} from './aiUtil';
import type { PreprocessResult } from './promptPreprocess';

// --------------------------------------------------------------------------
// To pass MkBrowser's own real-filesystem tools to the Deep Agent, uncomment
// the import below and the `tools` property inside createMkBrowserDeepAgent().
//
// IMPORTANT: The app's `read_file` and `write_file` tool names collide with
// Deep Agents' built-in virtual-filesystem tools of the same name.  Before
// uncommenting, rename the app's tools (in src/ai/tools.ts) to avoid the
// collision — e.g. `mk_read_file`, `mk_write_file`.
//
// import { aiTools } from './tools';
// --------------------------------------------------------------------------

/** Set to true to use Deep Agents; false to use the original StateGraph path. */
export const USE_DEEP_AGENTS = true;

// Set to true to enable verbose debug logging for Deep Agent invocations.
const DEBUG = true;

function debugLog(...args: unknown[]) {
  if (DEBUG) console.log('[deepAgent DEBUG]', ...args);
}

// todo-0: move this system prompt into a prompt's shared constance file and also see if we can incorporate this into our 
// non-DeepAgent (i.e. plain LangGraph code as well)
const MKBROWSER_SYSTEM_PROMPT = `You are the MkBrowser AI assistant — a helpful, knowledgeable assistant \
embedded in a desktop Markdown browser application. You help users with \
writing, editing, research, analysis, and general questions.

When responding, use well-formatted Markdown. You can use headings, lists, \
code blocks, tables, and other Markdown constructs as appropriate.`;

/**
 * Create a Deep Agent configured for MkBrowser.
 *
 * Returns a compiled LangGraph graph with the same .invoke() / .streamEvents()
 * API as the hand-built StateGraph in aiUtil.ts.
 */
function createMkBrowserDeepAgent() {
  const model = createChatModel();

  debugLog('createMkBrowserDeepAgent → creating deep agent');
  const agent = createDeepAgent({
    model,
    systemPrompt: MKBROWSER_SYSTEM_PROMPT,
    // ── Custom tools (commented out until tool names are de-collided) ──
    // Uncomment after renaming read_file → mk_read_file, write_file → mk_write_file
    // in src/ai/tools.ts:
    // tools: aiTools,
  });

  return agent;
}

// ── 3-minute hard timeout (matches aiUtil.ts) ──────────────────────────────
const MODEL_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Non-streaming Deep Agent invocation — parallel to `invokeAI` in aiUtil.ts.
 */
export async function invokeDeepAgent(
  prompt: PreprocessResult,
  history: BaseMessage[] = [],
): Promise<AIInvokeResult> {
  debugLog('invokeDeepAgent → creating agent');
  const agent = createMkBrowserDeepAgent();
  const humanMsg = buildHumanMessage(prompt);

  const { provider, model: modelName } = getActiveModelConfig();
  debugLog('invokeDeepAgent → provider:', provider, '| model:', modelName,
    '| history:', history.length, '| prompt length:', prompt.text.length,
    '| images:', prompt.images.length);

  try {
    const invokePromise = agent.invoke({
      messages: [...history, humanMsg],
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Deep Agent request timed out after ${MODEL_TIMEOUT_MS / 1000}s.`)),
        MODEL_TIMEOUT_MS,
      ),
    );
    const result = await Promise.race([invokePromise, timeoutPromise]);

    debugLog('invokeDeepAgent → agent finished successfully');
    const lastMessage = result.messages[result.messages.length - 1];

    let content = typeof lastMessage.content === 'string'
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);
    const usage = extractUsage(lastMessage);

    // Extract thinking content (same logic as invokeAI)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const additionalKwargs = (lastMessage as any).additional_kwargs ?? {};
    let thinking: string | undefined;
    const rawThinking = additionalKwargs.reasoning_content;
    if (typeof rawThinking === 'string' && rawThinking.length > 0) {
      thinking = rawThinking;
    } else {
      const thinkMatch = content.match(/^<think>([\s\S]*?)<\/think>\s*/);
      if (thinkMatch) {
        thinking = thinkMatch[1].trim();
        content = content.slice(thinkMatch[0].length);
      }
    }

    debugLog('invokeDeepAgent → returning response, length:', content.length,
      'thinking:', thinking ? thinking.length + ' chars' : 'none', 'usage:', usage);
    return { content, thinking, usage };
  } catch (err) {
    debugLog('invokeDeepAgent → ERROR:', err);
    throw err;
  }
}

/**
 * Streaming Deep Agent invocation — parallel to `streamAI` in aiUtil.ts.
 *
 * Uses `agent.streamEvents()` to emit token-level chunks, thinking tokens,
 * and tool call status lines via callbacks.
 */
export async function streamDeepAgent(
  prompt: PreprocessResult,
  history: BaseMessage[] = [],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<AIInvokeResult> {
  debugLog('streamDeepAgent → creating agent');
  const agent = createMkBrowserDeepAgent();
  const humanMsg = buildHumanMessage(prompt);

  let contentAccum = '';
  let thinkingAccum = '';
  let usage: AIUsageInfo | undefined;
  // Track whether we're inside a <think> block (llama.cpp inline thinking)
  let insideLlamacppThink = false;
  let pendingContent = '';

  debugLog('streamDeepAgent → starting streamEvents');
  try {
    const eventStream = agent.streamEvents(
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
              const thinkText = pendingContent.slice(0, closeIdx);
              if (thinkText.length > 0) {
                thinkingAccum += thinkText;
                callbacks.onThinkingChunk(thinkText);
              }
              pendingContent = pendingContent.slice(closeIdx + '</think>'.length);
              insideLlamacppThink = false;
              const trimmed = pendingContent.replace(/^\s+/, '');
              pendingContent = trimmed;
            } else {
              thinkingAccum += pendingContent;
              callbacks.onThinkingChunk(pendingContent);
              pendingContent = '';
            }
          } else {
            const openIdx = pendingContent.indexOf('<think>');
            if (openIdx !== -1) {
              const beforeThink = pendingContent.slice(0, openIdx);
              if (beforeThink.length > 0) {
                contentAccum += beforeThink;
                callbacks.onChunk(beforeThink);
              }
              pendingContent = pendingContent.slice(openIdx + '<think>'.length);
              insideLlamacppThink = true;
            } else {
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
        const input = event.data?.input;
        let summary = '';
        if (input && typeof input === 'object') {
          const values = Object.values(input);
          const firstStr = values.find((v): v is string => typeof v === 'string');
          if (firstStr) {
            summary = firstStr.length > 60 ? firstStr.slice(0, 57) + '...' : firstStr;
          }
        } else if (typeof input === 'string') {
          summary = input.length > 60 ? input.slice(0, 57) + '...' : input;
        }
        debugLog('streamDeepAgent → tool call:', toolName, summary);
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

    debugLog('streamDeepAgent → stream completed, content length:', contentAccum.length,
      'thinking:', thinkingAccum.length > 0 ? thinkingAccum.length + ' chars' : 'none');
    return {
      content: contentAccum,
      thinking: thinkingAccum.length > 0 ? thinkingAccum : undefined,
      usage,
    };
  } catch (err) {
    // If aborted, return what we have so far
    if (signal?.aborted) {
      debugLog('streamDeepAgent → aborted by user, returning partial content (' + contentAccum.length + ' chars)');
      return {
        content: contentAccum,
        thinking: thinkingAccum.length > 0 ? thinkingAccum : undefined,
        usage,
      };
    }
    debugLog('streamDeepAgent → ERROR:', err);
    throw err;
  }
}
