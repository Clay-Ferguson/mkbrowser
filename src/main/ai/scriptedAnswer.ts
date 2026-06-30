/**
 * scriptedAnswer.ts — canned AI response queue for testing.
 *
 * Playwright e2e tests inject a predetermined answer via {@link queueScriptedAnswer}
 * so that AI invocations in `langGraph.ts` and `deepAgent.ts` return a known
 * string without hitting a real LLM.  The queued value is consumed (cleared)
 * on first read, so subsequent invocations fall through to the live model.
 *
 * This module runs in the main process only — never import from the renderer.
 */

let scriptedAnswer: string | null = null;

/**
 * Queue a canned answer to be returned by the next AI invocation.
 * Overwrites any previously queued answer.
 */
export function queueScriptedAnswer(answer: string): void {
  scriptedAnswer = answer;
}

/** Returns true when a scripted answer is waiting to be consumed. */
export function hasScriptedAnswer(): boolean {
  return scriptedAnswer !== null;
}

/**
 * Pop and return the queued scripted answer, clearing it so subsequent
 * invocations use the live model.  Returns null when no answer is queued.
 */
export function consumeScriptedAnswer(): string | null {
  const answer = scriptedAnswer;
  scriptedAnswer = null;
  return answer;
}
