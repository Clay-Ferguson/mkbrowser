/** System prompt shared by both the LangGraph and Deep Agents invocation paths. */
export const MKBROWSER_SYSTEM_PROMPT = //
`You are the MkBrowser AI assistant — a helpful, knowledgeable assistant \
embedded in a desktop Markdown browser application. You help users with \
writing, editing, research, analysis, and general questions.

When responding, use well-formatted Markdown. You can use headings, lists, \
code blocks, tables, and other Markdown constructs as appropriate.`;

/** Default AI rewrite prompt — used when the user has not customised the prompt in settings. */
export const DEFAULT_AI_REWRITE_PERSONA = //
`You are a helpful agent.`;

/**
 * Build the system prompt for an AI invocation, optionally prefixing the
 * user's selected persona. The persona is woven into the system prompt so it
 * stays operative across every interaction — both conversational "Ask AI"
 * turns and one-shot "AI Rewrite" calls — and so it works uniformly across
 * providers via LangChain's SystemMessage.
 *
 * @param persona  The resolved persona prompt to apply, or undefined/empty to
 *                 use the base system prompt with no persona.
 */
export function buildSystemPrompt(persona?: string): string {
  const trimmed = persona?.trim();
  if (!trimmed) return MKBROWSER_SYSTEM_PROMPT;
  return `${MKBROWSER_SYSTEM_PROMPT}\n\n${trimmed}`;
}

export const AI_REWRITE_PROMPT = //
`Rewrite and improve the following content (in the <content> tag). \
Fix grammar, improve clarity, and enhance readability while preserving the original meaning and general structure. \
Return ONLY the rewritten content — no preamble, no explanation, no markdown code fences, no wrapping. \
Just the improved text.`;

export const AI_REWRITE_SELECTION_PROMPT = //
`The following content (in the <content> tag) contains a region wrapped in <rewrite_region> tags. \
Rewrite and improve ONLY the text inside the <rewrite_region> tags. \
Use the surrounding content for context to ensure coherence, but do NOT include any of the surrounding content in your response. \
Fix grammar, improve clarity, and enhance readability while preserving the original meaning and general structure. \
Return ONLY the rewritten text that should replace the <rewrite_region> content — no preamble, no explanation, no markdown code fences, no wrapping, no <rewrite_region> tags. \
Just the improved text for that region.`;
