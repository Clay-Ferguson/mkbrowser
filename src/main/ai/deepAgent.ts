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
  buildHumanMessage,
  extractUsage,
  type AIInvokeResult,
  type StreamCallbacks,
} from './langGraph';
import { createChatModel, getActiveModelConfig } from './aiModel';
import type { PreprocessResult } from './promptPreprocess';

import { aiTools } from './tools';
import { getConfig } from '../../configMgr';
import { logger } from '../../shared/logUtil';
import { consumeScriptedAnswer } from './scriptedAnswer';
import { getReasoningContent } from './messageUtil';
import { StreamProcessor } from '../../main/ai/streamProcessor';
import { checkHealth } from './llamaServer';

/** 
 * Set to true to use Deep Agents; false to use the original StateGraph path. 
 * 
 * NOTE: When this mode is enabled, our small local model will appear to hang (on slow shared memory CPU),
 * but that's just because using Deep Agents does things that consume way more tokens than the code path thru the LangChain
 * code where we're NOT using this flag. I'm making this an optional flag so that it is possible to run small models in a 
 * somewhat performant way with a reasonable TPS (Tokens Per Second) at least by setting this flag and rebuilding. For now
 * I don't consider this important enough to make it a user configurable setting at runtime.
 * 
 */
export const ALLOW_DEEP_AGENTS = true;

// Set to true to enable verbose debug logging for Deep Agent invocations.
const DEBUG = true;

function debugLog(...args: unknown[]) {
  if (DEBUG) logger.log('[deepAgent DEBUG]', ...args);
}

import { buildSystemPrompt } from '../../shared/ai/aiPrompts';

/**
 * Create a Deep Agent configured for MkBrowser.
 *
 * Returns a compiled LangGraph graph with the same .invoke() / .streamEvents()
 * API as the hand-built StateGraph in aiUtil.ts.
 *
 * @param persona  Resolved persona prompt to weave into the system prompt.
 */
function createMkBrowserDeepAgent(persona?: string) {
  const model = createChatModel();

  debugLog('createMkBrowserDeepAgent → creating deep agent');
  const useTools = aiTools.length > 0 && getConfig().agenticMode;
  const agent = createDeepAgent({
    model,
    systemPrompt: buildSystemPrompt(persona),
    ...(useTools ? { tools: aiTools } : {}),
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
  persona?: string,
): Promise<AIInvokeResult> {
  const scripted = consumeScriptedAnswer();
  if (scripted !== null) {
    debugLog('invokeDeepAgent → returning scripted answer');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return { content: scripted, usage: undefined };
  }
  debugLog('invokeDeepAgent → creating agent');
  const agent = createMkBrowserDeepAgent(persona);
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
    let thinking = getReasoningContent(lastMessage);
    if (!thinking) {
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
  persona?: string,
): Promise<AIInvokeResult> {
  const scripted = consumeScriptedAnswer();
  if (scripted !== null) {
    debugLog('streamDeepAgent → returning scripted answer');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return { content: scripted, usage: undefined };
  }
  debugLog('streamDeepAgent → creating agent');
  const agent = createMkBrowserDeepAgent(persona);
  const humanMsg = buildHumanMessage(prompt);

  const processor = new StreamProcessor(callbacks);

  debugLog('streamDeepAgent → starting streamEvents');
  try {
    debugLog('streamDeepAgent → calling agent.streamEvents()');
    const eventStream = agent.streamEvents(
      { messages: [...history, humanMsg] },
      { version: 'v2', signal },
    );
    debugLog('streamDeepAgent → eventStream created, entering for-await loop');

    let eventCount = 0;
    const heartbeat = setInterval(() => {
      checkHealth()
        .catch(() => 'error')
        .then(health => {
          debugLog(`streamDeepAgent → still waiting… ${eventCount} events received so far | llamacpp health: ${health}`);
        })
        .catch((err: unknown) => debugLog('streamDeepAgent → heartbeat failed:', err));
    }, 5000);

    try {
      for await (const event of eventStream) {
        eventCount++;
        if (eventCount <= 10 || event.event === 'on_chat_model_start' || event.event === 'on_chain_end') {
          debugLog(`streamDeepAgent → event[${eventCount}]: ${event.event} name=${event.name ?? '(none)'}`);
        }
        processor.handleEvent(event);
      }
    } finally {
      clearInterval(heartbeat);
    }

    const result = processor.finish();
    debugLog('streamDeepAgent → stream completed, content length:', result.content.length,
      'thinking:', result.thinking ? result.thinking.length + ' chars' : 'none');
    return result;
  } catch (err) {
    // If aborted, return what we have so far
    if (signal?.aborted) {
      const result = processor.finish();
      debugLog('streamDeepAgent → aborted by user, returning partial content (' + result.content.length + ' chars)');
      return result;
    }
    debugLog('streamDeepAgent → ERROR:', err);
    throw err;
  }
}
