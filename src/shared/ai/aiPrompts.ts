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

/**
 * Explains the `<ai>` interjection convention: a block the user embeds in their own
 * text whose contents are instructions for the rewrite rather than prose to rewrite.
 *
 * The block is deliberately preserved verbatim in the output rather than consumed —
 * it is the user's standing note to the AI, which they keep in the document so they
 * can tweak it and re-run the rewrite.
 *
 * Two things this wording is load-bearing about, both learned by breaking them:
 *   - Acting on the interjection comes FIRST and gets the emphasis. Leading with the
 *     preservation rule (or padding it out) reads as "leave things alone" and the
 *     model returns the passage barely touched, request unfulfilled.
 *   - The worked example uses a throwaway subject and disclaims itself. The rewrite
 *     prompts both forbid returning anything "from outside <content>", so an example
 *     whose subject overlaps the user's actual text gets treated as off-limits
 *     material — the model then avoids exactly the detail the interjection asked for.
 *   - The literal line breaks are part of the content, not cosmetic. Unlike the other
 *     prompts here, this one teaches a shape — an <ai> block sitting on its own lines,
 *     the way it appears in the user's file. Ending these lines with the usual `\`
 *     continuation collapses the example into one inline run of tags that no longer
 *     resembles what the model will actually be handed.
 *
 * Appended to the end of BOTH rewrite prompts so the convention works identically on
 * the whole-file and selection paths. Note it only reaches the model for interjections
 * inside `<content>` — one sitting outside the selection lands in `<context>`, which
 * {@link AI_REWRITE_CONTEXT_NOTE} tells the model to ignore.
 */
export const AI_INTERJECTION_PROMPT = //
`
The text may contain interjections: blocks wrapped in <ai> and </ai> tags. An interjection is a \
request the user is making of you, written in place. Do exactly what it asks.

CARRY OUT THE REQUEST. Write what it asks for into the prose around it, drawing on your own knowledge \
where the request calls for facts, names, examples, or detail the text does not already contain. This \
is the whole point of an interjection: it asks for something that is not there yet, so the passage it \
sits in MUST come back materially changed. Polishing that passage without doing what the interjection \
asked is a failed response.

THEN PUT THE BLOCK BACK. Copy the <ai> block into your output word for word, tags included, in the \
position it already occupies. It is the one piece of text you never rewrite, because the user keeps \
these requests in the document to edit and re-run later. Keeping the block does not soften the rule \
above — the surrounding prose still has to change.

For example, given this text:

The Smith Building has stood on Water Street since 1974.
<ai>
Describe the architectural style...
</ai>

your response would be this — the requested detail actually written in, and the block still intact:

The Smith Building, a squat brick-and-glass example of late Brutalism, has stood on Water Street \
since 1974.
<ai>
Describe the architectural style...
</ai>

The interjection asked you to provide architectural style in your response and so you did that by \
mentioning Brutalism. However of course, the example above is only an illustration of the ai-tag \
convention. Its subject matter has nothing to do with the text you are rewriting.`;

export const AI_REWRITE_PROMPT = //
`Rewrite and improve the text inside the <content> tag. \
Fix grammar, improve clarity, and enhance readability while preserving the original meaning and general structure. \
Return ONLY the rewritten text that replaces what was inside <content> — no preamble, no explanation, and nothing that came from outside <content>. \
Just the improved text.
`+AI_INTERJECTION_PROMPT;


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
no markdown code fences, no <content> or <context> tags, and nothing that came from outside <content>. \
Just the improved text.
`+AI_INTERJECTION_PROMPT;
