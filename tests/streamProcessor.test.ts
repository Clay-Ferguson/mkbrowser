/**
 * Unit tests for StreamProcessor (src/main/ai/streamProcessor.ts).
 *
 * StreamProcessor consumes LangGraph `streamEvents()` events and accumulates
 * content / thinking / usage while splitting out llama.cpp inline
 * <think>...</think> tags. None of this touches an LLM — we feed it synthetic
 * event objects shaped like the real stream events and assert on the callbacks
 * and the accumulated `.result`.
 *
 * At runtime StreamProcessor only imports the dependency-free messageUtil
 * module (its langGraph imports are type-only and erased), so it loads without
 * Electron or LangChain.
 */
import { describe, it, expect, vi } from 'vitest';
import { StreamProcessor, type StreamEventLike } from '../src/main/ai/streamProcessor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a StreamProcessor wired to vitest mock callbacks for inspection. */
function makeProcessor() {
  const onChunk = vi.fn();
  const onThinkingChunk = vi.fn();
  const onToolCall = vi.fn();
  const processor = new StreamProcessor({ onChunk, onThinkingChunk, onToolCall });
  return { processor, onChunk, onThinkingChunk, onToolCall };
}

/** A token chunk event carrying string content. */
function chunkEvent(content: unknown, additional_kwargs?: Record<string, unknown>): StreamEventLike {
  return { event: 'on_chat_model_stream', data: { chunk: { content, additional_kwargs } } };
}

/** A tool-start event. */
function toolStartEvent(name: string, input: unknown): StreamEventLike {
  return { event: 'on_tool_start', name, data: { input } };
}

/** A chat-model-end event carrying usage metadata. */
function modelEndEvent(usage_metadata: unknown): StreamEventLike {
  return { event: 'on_chat_model_end', data: { output: { usage_metadata } } };
}

/** Concatenate all string args passed to a mock across its calls. */
function joinCalls(mock: ReturnType<typeof vi.fn>): string {
  return mock.mock.calls.map((c) => c[0]).join('');
}

// ---------------------------------------------------------------------------
// Plain content
// ---------------------------------------------------------------------------

describe('StreamProcessor — plain content', () => {
  it('accumulates string content and forwards it to onChunk', () => {
    const { processor, onChunk, onThinkingChunk } = makeProcessor();
    processor.handleEvent(chunkEvent('Hello, '));
    processor.handleEvent(chunkEvent('world'));

    expect(joinCalls(onChunk)).toBe('Hello, world');
    expect(onThinkingChunk).not.toHaveBeenCalled();
    expect(processor.result.content).toBe('Hello, world');
    expect(processor.result.thinking).toBeUndefined();
    expect(processor.result.usage).toBeUndefined();
  });

  it('extracts text from a content-array (multimodal) chunk', () => {
    const { processor, onChunk } = makeProcessor();
    processor.handleEvent(
      chunkEvent([
        { type: 'text', text: 'foo' },
        { type: 'image_url', image_url: { url: 'data:...' } },
        { type: 'text', text: 'bar' },
      ]),
    );
    expect(processor.result.content).toBe('foobar');
    expect(joinCalls(onChunk)).toBe('foobar');
  });

  it('ignores empty and missing chunks', () => {
    const { processor, onChunk } = makeProcessor();
    processor.handleEvent(chunkEvent(''));
    processor.handleEvent({ event: 'on_chat_model_stream', data: { chunk: undefined } });
    processor.handleEvent(chunkEvent(123)); // non-string, non-array → no text
    expect(onChunk).not.toHaveBeenCalled();
    expect(processor.result.content).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Provider-native reasoning (additional_kwargs.reasoning_content)
// ---------------------------------------------------------------------------

describe('StreamProcessor — provider reasoning tokens', () => {
  it('routes reasoning_content to onThinkingChunk', () => {
    const { processor, onChunk, onThinkingChunk } = makeProcessor();
    processor.handleEvent(chunkEvent('', { reasoning_content: 'pondering' }));
    expect(joinCalls(onThinkingChunk)).toBe('pondering');
    expect(onChunk).not.toHaveBeenCalled();
    expect(processor.result.thinking).toBe('pondering');
    expect(processor.result.content).toBe('');
  });

  it('reasoning_content takes precedence over content on the same chunk', () => {
    const { processor, onChunk, onThinkingChunk } = makeProcessor();
    processor.handleEvent(chunkEvent('visible', { reasoning_content: 'hidden' }));
    expect(joinCalls(onThinkingChunk)).toBe('hidden');
    expect(onChunk).not.toHaveBeenCalled();
    expect(processor.result.content).toBe('');
  });
});

// ---------------------------------------------------------------------------
// llama.cpp inline <think>...</think> tag splitting
// ---------------------------------------------------------------------------

describe('StreamProcessor — inline <think> tags', () => {
  it('splits a single chunk containing a complete think block', () => {
    const { processor, onChunk, onThinkingChunk } = makeProcessor();
    processor.handleEvent(chunkEvent('<think>reasoning</think>answer'));
    expect(processor.result.thinking).toBe('reasoning');
    expect(processor.result.content).toBe('answer');
    expect(joinCalls(onThinkingChunk)).toBe('reasoning');
    expect(joinCalls(onChunk)).toBe('answer');
  });

  it('emits content before a think block as content', () => {
    const { processor } = makeProcessor();
    processor.handleEvent(chunkEvent('before<think>mid</think>after'));
    expect(processor.result.content).toBe('beforeafter');
    expect(processor.result.thinking).toBe('mid');
  });

  it('trims leading whitespace after the closing </think> tag', () => {
    const { processor } = makeProcessor();
    processor.handleEvent(chunkEvent('<think>t</think>\n\n  answer'));
    expect(processor.result.content).toBe('answer');
    expect(processor.result.thinking).toBe('t');
  });

  it('handles a think block whose tags span multiple chunks', () => {
    const { processor, onChunk, onThinkingChunk } = makeProcessor();
    processor.handleEvent(chunkEvent('<think>part one '));
    processor.handleEvent(chunkEvent('part two</think>visible '));
    processor.handleEvent(chunkEvent('answer'));

    expect(processor.result.thinking).toBe('part one part two');
    expect(processor.result.content).toBe('visible answer');
    expect(joinCalls(onThinkingChunk)).toBe('part one part two');
    expect(joinCalls(onChunk)).toBe('visible answer');
  });

  it('treats content with no think tags as ordinary content', () => {
    const { processor } = makeProcessor();
    processor.handleEvent(chunkEvent('just text'));
    expect(processor.result.content).toBe('just text');
    expect(processor.result.thinking).toBeUndefined();
  });

  // ── split-tag boundary cases (the bug fixed in item #5) ──

  it('reassembles an opening <think> tag split across chunks', () => {
    const { processor, onChunk } = makeProcessor();
    // The opening tag is fragmented: "<thi" + "nk>".
    processor.handleEvent(chunkEvent('before<thi'));
    processor.handleEvent(chunkEvent('nk>reasoning</think>after'));
    const result = processor.finish();

    expect(result.content).toBe('beforeafter');
    expect(result.thinking).toBe('reasoning');
    // The "<thi" fragment must never leak into visible content.
    expect(joinCalls(onChunk)).toBe('beforeafter');
  });

  it('reassembles a closing </think> tag split across chunks', () => {
    const { processor, onThinkingChunk } = makeProcessor();
    processor.handleEvent(chunkEvent('<think>reasoning</thi'));
    processor.handleEvent(chunkEvent('nk>answer'));
    const result = processor.finish();

    expect(result.thinking).toBe('reasoning');
    expect(result.content).toBe('answer');
    // The "</thi" fragment must not leak into the thinking stream.
    expect(joinCalls(onThinkingChunk)).toBe('reasoning');
  });

  it('handles a tag split one character at a time', () => {
    const { processor } = makeProcessor();
    for (const ch of '<think>hi</think>bye') {
      processor.handleEvent(chunkEvent(ch));
    }
    const result = processor.finish();
    expect(result.thinking).toBe('hi');
    expect(result.content).toBe('bye');
  });

  it('does not hold back a "<" that turns out to be literal content', () => {
    const { processor } = makeProcessor();
    processor.handleEvent(chunkEvent('a < b and c '));
    processor.handleEvent(chunkEvent('> d'));
    const result = processor.finish();
    expect(result.content).toBe('a < b and c > d');
    expect(result.thinking).toBeUndefined();
  });
});

describe('StreamProcessor — finish() flush', () => {
  it('emits a dangling partial-tag fragment verbatim when the stream ends', () => {
    const { processor, onChunk } = makeProcessor();
    // Stream ends mid-fragment; "<thi" never completes into a real tag.
    processor.handleEvent(chunkEvent('answer<thi'));
    // Before finishing, the fragment is held back, not yet emitted.
    expect(processor.result.content).toBe('answer');

    const result = processor.finish();
    expect(result.content).toBe('answer<thi');
    expect(joinCalls(onChunk)).toBe('answer<thi');
  });

  it('flushes remaining text of an unclosed think block as thinking', () => {
    const { processor } = makeProcessor();
    processor.handleEvent(chunkEvent('<think>still thinking when the stream died'));
    const result = processor.finish();
    expect(result.thinking).toBe('still thinking when the stream died');
    expect(result.content).toBe('');
  });

  it('is idempotent across repeated calls', () => {
    const { processor } = makeProcessor();
    processor.handleEvent(chunkEvent('done<thi'));
    expect(processor.finish().content).toBe('done<thi');
    expect(processor.finish().content).toBe('done<thi');
  });
});

// ---------------------------------------------------------------------------
// Tool-start status lines
// ---------------------------------------------------------------------------

describe('StreamProcessor — tool calls', () => {
  it('summarizes an object input using the first string value', () => {
    const { processor, onToolCall } = makeProcessor();
    processor.handleEvent(toolStartEvent('mk_read_file', { filePath: '/home/u/notes.md' }));
    expect(onToolCall).toHaveBeenCalledWith('mk_read_file', '/home/u/notes.md');
  });

  it('summarizes a bare string input', () => {
    const { processor, onToolCall } = makeProcessor();
    processor.handleEvent(toolStartEvent('some_tool', 'raw input'));
    expect(onToolCall).toHaveBeenCalledWith('some_tool', 'raw input');
  });

  it('truncates summaries longer than 60 chars to 57 chars + ellipsis', () => {
    const { processor, onToolCall } = makeProcessor();
    const long = 'x'.repeat(100);
    processor.handleEvent(toolStartEvent('t', { q: long }));
    const summary = onToolCall.mock.calls[0][1] as string;
    expect(summary).toBe('x'.repeat(57) + '...');
    expect(summary).toHaveLength(60);
  });

  it('falls back to "unknown" tool name and empty summary', () => {
    const { processor, onToolCall } = makeProcessor();
    processor.handleEvent({ event: 'on_tool_start', data: { input: { n: 42 } } });
    expect(onToolCall).toHaveBeenCalledWith('unknown', '');
  });
});

// ---------------------------------------------------------------------------
// Usage metadata
// ---------------------------------------------------------------------------

describe('StreamProcessor — usage metadata', () => {
  it('captures full usage metadata from on_chat_model_end', () => {
    const { processor } = makeProcessor();
    processor.handleEvent(modelEndEvent({ input_tokens: 10, output_tokens: 5, total_tokens: 15 }));
    expect(processor.result.usage).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  });

  it('defaults output_tokens to 0 and derives total_tokens when absent', () => {
    const { processor } = makeProcessor();
    processor.handleEvent(modelEndEvent({ input_tokens: 8 }));
    expect(processor.result.usage).toEqual({ input_tokens: 8, output_tokens: 0, total_tokens: 8 });
  });

  it('ignores usage metadata without a numeric input_tokens', () => {
    const { processor } = makeProcessor();
    processor.handleEvent(modelEndEvent({ output_tokens: 5 }));
    expect(processor.result.usage).toBeUndefined();
  });

  it('ignores a model-end event with no output', () => {
    const { processor } = makeProcessor();
    processor.handleEvent({ event: 'on_chat_model_end', data: { output: undefined } });
    expect(processor.result.usage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Misc / integration
// ---------------------------------------------------------------------------

describe('StreamProcessor — misc', () => {
  it('ignores unrecognized event types', () => {
    const { processor, onChunk, onThinkingChunk, onToolCall } = makeProcessor();
    processor.handleEvent({ event: 'on_chain_start' });
    processor.handleEvent({ event: 'on_chat_model_start' });
    expect(onChunk).not.toHaveBeenCalled();
    expect(onThinkingChunk).not.toHaveBeenCalled();
    expect(onToolCall).not.toHaveBeenCalled();
  });

  it('accumulates a realistic mixed stream', () => {
    const { processor } = makeProcessor();
    processor.handleEvent(chunkEvent('<think>let me check the file</think>'));
    processor.handleEvent(toolStartEvent('mk_read_file', { filePath: '/tmp/a.md' }));
    processor.handleEvent(chunkEvent('Here is '));
    processor.handleEvent(chunkEvent('the answer.'));
    processor.handleEvent(modelEndEvent({ input_tokens: 100, output_tokens: 20, total_tokens: 120 }));

    const result = processor.result;
    expect(result.content).toBe('Here is the answer.');
    expect(result.thinking).toBe('let me check the file');
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 20, total_tokens: 120 });
  });
});
