/**
 * streamProcessor.ts — shared processing for the streaming AI paths.
 *
 * Both `streamAI` (langGraph.ts) and `streamDeepAgent` (deepAgent.ts) consume a
 * LangGraph `streamEvents()` v2 stream and need identical handling:
 *   - token chunks, including llama.cpp inline `<think>...</think>` tags
 *   - reasoning_content thinking tokens (Anthropic / OpenAI o-series)
 *   - tool-start status lines
 *   - usage metadata from the final chat-model message
 *
 * This class owns that logic plus the per-stream mutable state (accumulated
 * content / thinking, usage, and the inline think-tag state machine) so the two
 * call sites share one implementation instead of duplicating ~90 lines each.
 *
 * This module runs in the main process only — never import from the renderer.
 */
import type { StreamCallbacks, AIInvokeResult, AIUsageInfo } from './langGraph';
import { getReasoningContent, getUsageMetadata } from './messageUtil';

/** Minimal shape of a LangGraph `streamEvents()` v2 event that we read. */
export interface StreamEventLike {
  event: string;
  name?: string;
  data?: {
    chunk?: unknown;
    input?: unknown;
    output?: unknown;
  };
}

/** Max characters of a tool input echoed into the status line. */
const TOOL_SUMMARY_MAX = 60;

/** llama.cpp inline thinking delimiters. */
const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

/**
 * Stateful consumer of a streamEvents() stream. Feed each event to
 * {@link handleEvent}; read {@link result} once the stream ends (or is aborted)
 * for the accumulated content, thinking, and usage.
 */
export class StreamProcessor {
  private contentAccum = '';
  private thinkingAccum = '';
  private usage: AIUsageInfo | undefined;

  // llama.cpp inline <think>...</think> tag state machine
  private insideThink = false;
  private pendingContent = '';

  constructor(private readonly callbacks: StreamCallbacks) {}

  /** Dispatch a single streamEvents() event to the appropriate handler. */
  handleEvent(event: StreamEventLike): void {
    switch (event.event) {
      case 'on_chat_model_stream':
        this.handleChunk(event.data?.chunk);
        break;
      case 'on_tool_start':
        this.callbacks.onToolCall(event.name ?? 'unknown', summarizeToolInput(event.data?.input));
        break;
      case 'on_chat_model_end':
        this.handleModelEnd(event.data?.output);
        break;
    }
  }

  /**
   * Flush any buffered text and return the accumulated result. Call this once
   * the stream has ended (or been aborted). A trailing fragment that looked
   * like the start of a split `<think>`/`</think>` tag but never completed is
   * emitted verbatim here rather than being silently swallowed.
   *
   * Idempotent: after the flush the pending buffer is empty, so repeat calls
   * just return the same result.
   */
  finish(): AIInvokeResult {
    this.drainPending(true);
    return this.result;
  }

  /** The accumulated streaming result so far (without flushing the buffer). */
  get result(): AIInvokeResult {
    return {
      content: this.contentAccum,
      thinking: this.thinkingAccum.length > 0 ? this.thinkingAccum : undefined,
      usage: this.usage,
    };
  }

  // ── token chunks ──────────────────────────────────────────────────────────
  private handleChunk(chunk: unknown): void {
    if (!chunk) return;

    // Provider-native thinking (Anthropic, OpenAI o-series) arrives separately
    // from the visible content, so emit it directly and stop.
    const reasoning = getReasoningContent(chunk);
    if (reasoning) {
      this.emitThinking(reasoning);
      return;
    }

    const text = extractChunkText(chunk);
    if (text.length === 0) return;

    this.pendingContent += text;
    this.drainPending(false);
  }

  /**
   * Split buffered text into visible content and llama.cpp inline
   * `<think>...</think>` thinking, emitting each via the callbacks.
   *
   * A `<think>`/`</think>` tag can be split across chunk boundaries (e.g.
   * `"<thi"` then `"nk>"`). Mid-stream (`isFinal === false`) we therefore hold
   * back a trailing fragment that could be the start of the tag we're scanning
   * for, leaving it in `pendingContent` until the next chunk arrives. On the
   * final drain we emit everything, since no more text is coming.
   */
  private drainPending(isFinal: boolean): void {
    while (this.pendingContent.length > 0) {
      if (this.insideThink) {
        const closeIdx = this.pendingContent.indexOf(CLOSE_TAG);
        if (closeIdx !== -1) {
          const thinkText = this.pendingContent.slice(0, closeIdx);
          if (thinkText.length > 0) this.emitThinking(thinkText);
          // Drop the closing tag and any leading whitespace after it.
          this.pendingContent = this.pendingContent
            .slice(closeIdx + CLOSE_TAG.length)
            .replace(/^\s+/, '');
          this.insideThink = false;
          continue;
        }
        // No complete closing tag yet — emit all but a possible partial tag.
        if (this.emitAllButPartial(CLOSE_TAG, isFinal, (t) => this.emitThinking(t))) break;
      } else {
        const openIdx = this.pendingContent.indexOf(OPEN_TAG);
        if (openIdx !== -1) {
          const beforeThink = this.pendingContent.slice(0, openIdx);
          if (beforeThink.length > 0) this.emitContent(beforeThink);
          this.pendingContent = this.pendingContent.slice(openIdx + OPEN_TAG.length);
          this.insideThink = true;
          continue;
        }
        // No complete opening tag — emit all but a possible partial tag.
        if (this.emitAllButPartial(OPEN_TAG, isFinal, (t) => this.emitContent(t))) break;
      }
    }
  }

  /**
   * Emit `pendingContent` minus a trailing fragment that could still grow into
   * `tag`, retaining that fragment for the next chunk. When `isFinal` nothing is
   * held back. Returns true to signal the caller to stop draining (no complete
   * tag is present, so further progress needs more input).
   */
  private emitAllButPartial(tag: string, isFinal: boolean, emit: (text: string) => void): true {
    const hold = isFinal ? 0 : partialTagSuffixLen(this.pendingContent, tag);
    const emitLen = this.pendingContent.length - hold;
    if (emitLen > 0) {
      emit(this.pendingContent.slice(0, emitLen));
      this.pendingContent = this.pendingContent.slice(emitLen);
    }
    return true;
  }

  private emitContent(text: string): void {
    this.contentAccum += text;
    this.callbacks.onChunk(text);
  }

  private emitThinking(text: string): void {
    this.thinkingAccum += text;
    this.callbacks.onThinkingChunk(text);
  }

  // ── usage metadata from the final chat-model message ────────────────────────
  private handleModelEnd(output: unknown): void {
    if (!output) return;
    const meta = getUsageMetadata(output);
    if (!meta) return;
    this.usage = {
      input_tokens: meta.input_tokens,
      output_tokens: meta.output_tokens ?? 0,
      total_tokens: meta.total_tokens ?? meta.input_tokens + (meta.output_tokens ?? 0),
    };
  }
}

/**
 * Length of the longest suffix of `text` that is a proper prefix of `tag`
 * (i.e. the in-progress portion of a tag split across chunk boundaries).
 * Returns 0 when no suffix of `text` begins `tag`. Capped at `tag.length - 1`,
 * since a complete tag is detected by `indexOf` before this is consulted.
 */
function partialTagSuffixLen(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let k = max; k > 0; k--) {
    if (text.endsWith(tag.slice(0, k))) return k;
  }
  return 0;
}

/** Extract plain text from a stream chunk's content (string or content-array). */
function extractChunkText(chunk: unknown): string {
  const content = (chunk as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let text = '';
    for (const part of content) {
      if (part && typeof part === 'object' && (part as { type?: unknown }).type === 'text') {
        const partText = (part as { text?: unknown }).text;
        if (typeof partText === 'string') text += partText;
      }
    }
    return text;
  }
  return '';
}

/** Build a brief one-line summary from a tool's input object or string. */
function summarizeToolInput(input: unknown): string {
  let raw = '';
  if (typeof input === 'string') {
    raw = input;
  } else if (input && typeof input === 'object') {
    // Take the first string value as a brief summary.
    const firstStr = Object.values(input).find((v): v is string => typeof v === 'string');
    raw = firstStr ?? '';
  }
  return raw.length > TOOL_SUMMARY_MAX ? raw.slice(0, TOOL_SUMMARY_MAX - 3) + '...' : raw;
}
