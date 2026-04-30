let scriptedAnswer: string | null = null;

export function queueScriptedAnswer(answer: string): void {
  scriptedAnswer = answer;
}

export function hasScriptedAnswer(): boolean {
  return scriptedAnswer !== null;
}

export function consumeScriptedAnswer(): string | null {
  const answer = scriptedAnswer;
  scriptedAnswer = null;
  return answer;
}
