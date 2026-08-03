/**
 * aiFileLog.ts — writes every LLM round-trip to a pair of files on disk.
 *
 * For each call the model makes we write two Markdown files into
 * `~/.config/mk-browser/logs/ai` (Electron's `app.getPath('logs')`):
 *
 *   2026-08-02--14-30-05-123-prompt.md     the fully-assembled prompt
 *   2026-08-02--14-30-05-123-response.md   the model's reply
 *
 * Both files of a pair share the round-trip's *start* timestamp, so a sorted
 * directory listing reads chronologically and keeps each pair adjacent. A
 * failed call writes `-error.md` in place of `-response.md`.
 *
 * "Round-trip" is the unit here, not "user request": when agentic mode loops
 * the model through the ToolNode, each iteration produces its own pair, so you
 * can see exactly what the model saw each time it was asked.
 *
 * ## How this hooks into LangChain
 *
 * This is a plain `BaseCallbackHandler` — LangChain's own open-source callback
 * layer, the same extension point LangSmith is built on. We deliberately do not
 * use LangSmith: nothing here sets `LANGCHAIN_TRACING_V2` / `LANGCHAIN_API_KEY`
 * / `LANGSMITH_*`, and LangChain only attaches its `LangChainTracer` when those
 * env vars are present, so no data leaves the machine.
 *
 * The handler is attached as a *constructor* callback in `createChatModel()`
 * (aiModel.ts), which means it applies to every invocation of that model and
 * survives both `.bindTools()` and being handed to `createDeepAgent({ model })`.
 * That one attachment point covers all four invocation paths — `invokeAI`,
 * `streamAI`, `invokeDeepAgent`, `streamDeepAgent` — including the two that
 * pass no RunnableConfig at all. `handleChatModelStart` fires with the message
 * array as the provider is about to receive it, and `handleLLMEnd` fires once
 * per round-trip; for streaming calls LangChain aggregates the chunks before
 * calling it, so streaming and non-streaming need no special handling here.
 *
 * There is no retention policy — the folder grows forever by design.
 *
 * This module runs in the main process only — never import from the renderer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { BaseMessage } from '@langchain/core/messages';
import type { LLMResult } from '@langchain/core/outputs';
import { logger } from '../../shared/logUtil';
import { getAdditionalKwargs, getReasoningContent, getUsageMetadata } from './messageUtil';

/** Set to false to stop writing AI prompt/response logs to disk. */
const AI_FILE_LOG: boolean = true;

/** Drop pending round-trips whose end event never arrived after this long. */
const RUN_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Log directory, resolved lazily. `app.getPath()` must not run at module load:
 * this module sits in `aiModel.ts`'s import chain, and unit tests that import
 * it would otherwise be forced to mock Electron before the first import.
 */
function logDir(): string {
  return path.join(app.getPath('logs'), 'ai');
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** Format a local-time epoch value as `YYYY-MM-DD--HH-MM-SS-mmm`. */
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
  const time = `${pad(d.getHours(), 2)}-${pad(d.getMinutes(), 2)}-${pad(d.getSeconds(), 2)}`;
  return `${date}--${time}-${pad(d.getMilliseconds(), 3)}`;
}

// Two round-trips can start within the same millisecond (Deep Agents spawns
// sub-agents concurrently), which would collide two pairs onto one filename.
// Handing out a strictly increasing millisecond keeps names unique without
// disturbing the chronological sort.
let lastStampMs = 0;

/** Reserve the next unused millisecond and return it. */
function nextStampMs(): number {
  lastStampMs = Math.max(Date.now(), lastStampMs + 1);
  return lastStampMs;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** A `{ type: 'image_url', image_url: { url } }` part, as LangChain models them. */
interface ImagePart {
  type: string;
  image_url?: { url?: unknown } | string;
  text?: unknown;
  source?: { media_type?: unknown; data?: unknown };
}

/**
 * Summarize an image content part instead of dumping its base64 payload. A
 * single screenshot is megabytes of base64, which would bury the actual prompt
 * and defeat the purpose of the log.
 */
function describeImage(part: ImagePart): string {
  const rawUrl = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
  const url = typeof rawUrl === 'string' ? rawUrl : '';
  const match = url.match(/^data:([^;]+);base64,(.*)$/s);
  if (match) {
    return `[image: ${match[1]}, ${match[2]?.length ?? 0} bytes base64 omitted]`;
  }
  // Anthropic-style `{ type: 'image', source: { media_type, data } }`
  const mediaType = part.source?.media_type;
  const data = part.source?.data;
  if (typeof mediaType === 'string' && typeof data === 'string') {
    return `[image: ${mediaType}, ${data.length} bytes base64 omitted]`;
  }
  if (url) return `[image: ${url}]`;
  return '[image]';
}

/** Render a message's `content` — a plain string, or a multimodal part array. */
function renderContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content, null, 2);

  const parts: string[] = [];
  for (const raw of content) {
    const part = raw as ImagePart;
    if (part?.type === 'text' && typeof part.text === 'string') {
      parts.push(part.text);
    } else if (part?.type === 'image_url' || part?.type === 'image') {
      parts.push(describeImage(part));
    } else {
      parts.push(JSON.stringify(raw, null, 2));
    }
  }
  return parts.join('\n');
}

/** Render the tool calls attached to an AI message, or '' when there are none. */
function renderToolCalls(msg: unknown): string {
  const calls = (msg as { tool_calls?: unknown })?.tool_calls;
  if (!Array.isArray(calls) || calls.length === 0) return '';

  const lines = calls.map((call) => {
    const c = call as { name?: unknown; id?: unknown; args?: unknown };
    const name = typeof c.name === 'string' ? c.name : '?';
    const id = typeof c.id === 'string' ? ` (id: ${c.id})` : '';
    return `- **${name}**${id}\n\`\`\`json\n${JSON.stringify(c.args ?? {}, null, 2)}\n\`\`\``;
  });
  return `\n\n_tool calls:_\n${lines.join('\n')}`;
}

/**
 * Render a message array as Markdown sections.
 *
 * We render by hand rather than using `getBufferString` from
 * `@langchain/core/messages`: that helper flattens content and drops tool calls
 * entirely, and tool calls are the single most useful thing to see when
 * debugging an agentic loop.
 */
export function renderMessages(messages: BaseMessage[]): string {
  const blocks = messages.map((msg, i) => {
    const type = typeof msg?.type === 'string' ? msg.type : 'unknown';
    const toolCallId = (msg as { tool_call_id?: unknown }).tool_call_id;
    const name = (msg as { name?: unknown }).name;

    const meta: string[] = [];
    if (typeof name === 'string' && name.length > 0) meta.push(`name: ${name}`);
    if (typeof toolCallId === 'string' && toolCallId.length > 0) meta.push(`tool_call_id: ${toolCallId}`);
    const metaLine = meta.length > 0 ? `\n_${meta.join(' · ')}_\n` : '';

    const reasoning = getReasoningContent(msg);
    const reasoningBlock = reasoning ? `\n\n_reasoning:_\n${reasoning}` : '';

    return `## [${i + 1}] ${type}\n${metaLine}\n${renderContent(msg?.content)}${renderToolCalls(msg)}${reasoningBlock}`;
  });
  return blocks.join('\n\n---\n\n');
}

/**
 * Render `additional_kwargs` as a JSON block, or '' when there is nothing
 * useful there. Providers routinely populate it with all-undefined keys
 * (OpenAI sets `function_call: undefined, tool_calls: undefined`), which would
 * otherwise emit an empty `{}` block on every single response.
 */
function renderAdditionalKwargs(message: unknown): string {
  const kwargs = getAdditionalKwargs(message);
  const meaningful = Object.entries(kwargs).filter(([, v]) => v !== undefined);
  if (meaningful.length === 0) return '';
  const json = JSON.stringify(Object.fromEntries(meaningful), null, 2);
  return `\n\n---\n\n_additional_kwargs:_\n\`\`\`json\n${json}\n\`\`\``;
}

/** Build the `# ...` header block that opens every log file. */
function renderHeader(title: string, fields: Record<string, string | number | undefined>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `- **${k}:** ${String(v)}`);
  return `# ${title}\n\n${lines.join('\n')}\n\n---\n\n`;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

// Serializes writes so concurrent round-trips can't interleave mkdir/write and
// so a slow disk can't fan out unbounded parallel I/O. Mirrors the queue in
// usageTracker.ts.
let logWriteQueue: Promise<void> = Promise.resolve();

/**
 * Chain `task` onto the serial write queue. Errors are reported under `label`
 * and swallowed — a logging failure must never surface as an AI failure.
 */
function enqueueLogWrite(task: () => Promise<void>, label: string): void {
  logWriteQueue = logWriteQueue
    .then(task)
    .catch((err: unknown) => { logger.error(`${label}:`, err); });
}

/**
 * Write `body` to `<stamp>-<suffix>.md`, creating the log dir as needed.
 *
 * Uses the `wx` flag so an existing file is never clobbered; on collision
 * (a clock step, or a name reused across app restarts) it advances one
 * millisecond and retries rather than losing either record.
 */
async function writeLogFile(stampMs: number, suffix: string, body: string): Promise<void> {
  const dir = logDir();
  await fs.promises.mkdir(dir, { recursive: true });

  let ms = stampMs;
  for (let attempt = 0; attempt < 100; attempt++) {
    const file = path.join(dir, `${formatStamp(ms)}-${suffix}.md`);
    try {
      await fs.promises.writeFile(file, `${body}\n`, { encoding: 'utf-8', flag: 'wx' });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
      ms += 1;
    }
  }
  throw new Error(`Could not find a free AI log filename near ${formatStamp(stampMs)}`);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** What we remember between a round-trip's start and its end. */
interface RunState {
  stampMs: number;
  startedAt: number;
}

/** Pull the human-readable model id out of the `Serialized` llm descriptor. */
function describeModel(llm: unknown): string | undefined {
  const kwargs = (llm as { kwargs?: Record<string, unknown> })?.kwargs;
  const model = kwargs?.model ?? kwargs?.modelName ?? kwargs?.model_name;
  return typeof model === 'string' ? model : undefined;
}

/** Token usage summary line for the response header, if the model reported any. */
function describeUsage(output: LLMResult, message: unknown): string | undefined {
  const meta = getUsageMetadata(message);
  if (meta) {
    return `in ${meta.input_tokens} / out ${meta.output_tokens ?? 0} / total ${meta.total_tokens ?? meta.input_tokens + (meta.output_tokens ?? 0)}`;
  }
  const tokenUsage = output.llmOutput?.tokenUsage as Record<string, unknown> | undefined;
  if (tokenUsage) return JSON.stringify(tokenUsage);
  return undefined;
}

/**
 * Callback handler that mirrors every LLM round-trip to disk. Attached as a
 * constructor callback in `createChatModel()`.
 */
class AiFileLogHandler extends BaseCallbackHandler {
  name = 'mkbrowser_ai_file_log';

  // Never make an AI call wait on our disk I/O; writes go through the queue.
  awaitHandlers = false;

  private runs = new Map<string, RunState>();

  /** Drop entries whose end event never arrived, so the map stays bounded. */
  private pruneStaleRuns(now: number): void {
    for (const [runId, state] of this.runs) {
      if (now - state.startedAt > RUN_STATE_TTL_MS) this.runs.delete(runId);
    }
  }

  /** Look up and consume the state recorded by `handleChatModelStart`. */
  private takeRun(runId: string): RunState {
    const state = this.runs.get(runId);
    if (state) {
      this.runs.delete(runId);
      return state;
    }
    // No matching start (e.g. a non-chat LLM, or a start we failed to record).
    // Still write the tail with a fresh stamp rather than dropping it.
    return { stampMs: nextStampMs(), startedAt: Date.now() };
  }

  handleChatModelStart(
    llm: unknown,
    messages: BaseMessage[][],
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
    runName?: string,
  ): void {
    try {
      const now = Date.now();
      this.pruneStaleRuns(now);

      const stampMs = nextStampMs();
      this.runs.set(runId, { stampMs, startedAt: now });

      // `messages` is a batch; our call sites only ever send one conversation.
      const conversation = messages[0] ?? [];
      const body =
        renderHeader('AI prompt', {
          time: new Date(stampMs).toISOString(),
          runId,
          run: runName,
          model: describeModel(llm),
          messages: conversation.length,
        }) + renderMessages(conversation);

      enqueueLogWrite(() => writeLogFile(stampMs, 'prompt', body), 'aiFileLog prompt write failed');
    } catch (err) {
      logger.error('aiFileLog handleChatModelStart failed:', err);
    }
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    try {
      const { stampMs, startedAt } = this.takeRun(runId);
      const generation = output.generations?.[0]?.[0];
      const message = (generation as { message?: unknown } | undefined)?.message;

      const body =
        renderHeader('AI response', {
          time: new Date().toISOString(),
          runId,
          durationMs: Date.now() - startedAt,
          usage: describeUsage(output, message),
        }) +
        (generation?.text ?? '') +
        renderToolCalls(message) +
        (getReasoningContent(message) ? `\n\n_reasoning:_\n${getReasoningContent(message)}` : '') +
        renderAdditionalKwargs(message);

      enqueueLogWrite(() => writeLogFile(stampMs, 'response', body), 'aiFileLog response write failed');
    } catch (err) {
      logger.error('aiFileLog handleLLMEnd failed:', err);
    }
  }

  handleLLMError(err: Error, runId: string): void {
    try {
      const { stampMs, startedAt } = this.takeRun(runId);
      const body =
        renderHeader('AI error', {
          time: new Date().toISOString(),
          runId,
          durationMs: Date.now() - startedAt,
        }) + `${err?.message ?? String(err)}\n\n\`\`\`\n${err?.stack ?? ''}\n\`\`\``;

      enqueueLogWrite(() => writeLogFile(stampMs, 'error', body), 'aiFileLog error write failed');
    } catch (writeErr) {
      logger.error('aiFileLog handleLLMError failed:', writeErr);
    }
  }
}

/**
 * Callbacks to pass to a chat model constructor — the singleton handler, or an
 * empty array when {@link AI_FILE_LOG} is off.
 */
export const aiFileLogCallbacks = AI_FILE_LOG ? [new AiFileLogHandler()] : [];

/** Exported for tests. */
export { AiFileLogHandler };
