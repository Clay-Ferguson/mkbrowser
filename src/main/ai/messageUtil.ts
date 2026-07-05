/**
 * messageUtil.ts — typed accessors for the loosely-typed fields LangChain
 * attaches to messages and stream chunks (additional_kwargs, tool_calls,
 * usage_metadata). LangChain's BaseMessage typings don't expose these
 * reliably across providers, so the unavoidable casts live here instead of
 * being scattered as `as any` at every call site.
 */

interface MessageExtras {
  additional_kwargs?: Record<string, unknown>;
  tool_calls?: unknown;
  usage_metadata?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
  };
}

/** Return the `additional_kwargs` map from a message, or an empty object when absent. */
export function getAdditionalKwargs(msg: unknown): Record<string, unknown> {
  return (msg as MessageExtras)?.additional_kwargs ?? {}; 
}

/**
 * Thinking text from additional_kwargs.reasoning_content (Anthropic,
 * OpenAI o-series via LangChain), or undefined when absent/empty.
 */
export function getReasoningContent(msg: unknown): string | undefined {
  const v = getAdditionalKwargs(msg).reasoning_content;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** True when the message carries at least one tool call. */
export function hasToolCalls(msg: unknown): boolean {
  const calls = (msg as MessageExtras)?.tool_calls; 
  return Array.isArray(calls) && calls.length > 0;
}

export interface UsageMetadata {
  input_tokens: number;
  output_tokens?: number;
  total_tokens?: number;
}

/** usage_metadata when present with numeric input_tokens, else undefined. */
export function getUsageMetadata(msg: unknown): UsageMetadata | undefined {
  const meta = (msg as MessageExtras)?.usage_metadata; 
  if (meta && typeof meta.input_tokens === 'number') {
    return {
      input_tokens: meta.input_tokens,
      output_tokens: typeof meta.output_tokens === 'number' ? meta.output_tokens : undefined,
      total_tokens: typeof meta.total_tokens === 'number' ? meta.total_tokens : undefined,
    };
  }
  return undefined;
}
