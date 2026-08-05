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
`Rewrite and improve the text inside the <content> tag. \
Fix grammar, improve clarity, and enhance readability while preserving the original meaning and general structure. \
Return ONLY the rewritten text that replaces what was inside <content> — no preamble, no explanation, and nothing that came from outside <content>. \
Just the improved text. \
\
If you see an <AI>-tag interjection in the content you are to interpret that as \
additional instructions to follow during your rewrite, to help you know what to write. For example, 
in the following <content> prompt it contains an AI interjection and you would follow it by 
adding bird species to the rewritten prose: \
<content> \
There are numerous birds in the Tennessee Valley Area. \
<ai> \
AI: Mention several bird species... \
</ai> \
</content> \
\
`;

/**
 * Sits between the `<context>` block and the rewrite instruction whenever surrounding
 * material is supplied — the rest of the current file on a selection rewrite, sibling
 * documents when full document context is enabled, or both. It explains the `<context>`
 * wrapper that `runRewrite` builds around them.
 *
 * Worded to read *after* the block it describes, since `runRewrite` puts the context
 * first and the instructions last (see the ordering comment there). Shared by both
 * rewrite prompts, which it can be because `<content>` marks the text to rewrite on
 * both paths.
 */
export const AI_REWRITE_CONTEXT_NOTE = //
`In the text above, the <content> tag holding the text to rewrite is nested inside a larger \
<context> tag holding the document around it — like this:

<context>...<content>rewrite this</content>...</context>

Everything inside <context> but outside <content> is there only so your rewrite stays \
coherent with the surrounding document. It is NOT part of what you are rewriting: never \
repeat, continue, or include any of it in your response. Your reply must contain nothing \
but the replacement for what was inside <content>.`;

export const AI_REWRITE_SELECTION_PROMPT = //
`Rewrite and improve the selected text (in the <content> tag). \
It is an excerpt from a larger document, so it may begin or end mid-sentence — rewrite it as the excerpt it is, without completing \
or trimming it to fit a sentence boundary. \
Fix grammar, improve clarity, and enhance readability while preserving the original meaning and general structure. \
Return ONLY the rewritten excerpt, which will replace the selection exactly as you return it — no preamble, no explanation, \
no markdown code fences, no tags, and nothing that came from outside <content>. \
Just the improved text.`;
