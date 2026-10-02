/**
 * Where the spell checker declines to look: words that are exempt because of their position
 * in the Markdown document rather than their spelling.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { extractWords, isSpellCheckExempt } from '../src/components/editor/spellChecker';

/** The words of `doc` (parsed as Markdown unless `plain`) that the spell checker would skip. */
function exemptWords(doc: string, plain = false): string[] {
  const state = EditorState.create({ doc, extensions: plain ? [] : [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(state, doc.length, 5000);
  return extractWords(doc).filter(({ from }) => isSpellCheckExempt(state, from)).map(({ word }) => word);
}

describe('isSpellCheckExempt', () => {
  it("exempts a fenced block's language, but not its content or the prose around it", () => {
    expect(exemptWords('Some yaml here\n\n```yaml\ntype: person\n```\n\nmore yaml')).toEqual(['yaml']);
  });

  it('exempts every word of a multi-word info string', () => {
    expect(exemptWords('```tsx title=demo\nconst a = 1;\n```')).toEqual(['tsx', 'title', 'demo']);
  });

  it('exempts the language of tilde, indented and still-unclosed fences', () => {
    expect(exemptWords('~~~mermaid\ngraph TD\n~~~')).toEqual(['mermaid']);
    expect(exemptWords('- item\n\n  ```yml\n  a: b\n  ```')).toEqual(['yml']);
    expect(exemptWords('```yaml\ntype: person')).toEqual(['yaml']);
  });

  it('exempts nothing in inline code or in a document that is not Markdown', () => {
    expect(exemptWords('use `yaml` here')).toEqual([]);
    expect(exemptWords('```yaml\ntype: person\n```', true)).toEqual([]);
  });
});
