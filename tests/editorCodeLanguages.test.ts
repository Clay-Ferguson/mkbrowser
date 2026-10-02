/**
 * Fenced YAML blocks in a Markdown document get YAML syntax colours in the editor: keys are
 * told apart from values, instead of the whole block being one "code" colour.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import { fencedCodeLanguage } from '../src/renderer/editor/editorCodeLanguages';
import { markdownHighlightStyle } from '../src/renderer/editor/editorMarkdownHighlight';

/** Highlights `doc` as the editor does and returns the style class covering `text` ('' = none). */
function classOf(doc: string, text: string): string {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, codeLanguages: fencedCodeLanguage })],
  });
  const tree = ensureSyntaxTree(state, doc.length, 5000);
  if (!tree) throw new Error('parse did not finish');

  const at = doc.indexOf(text);
  if (at === -1) throw new Error(`"${text}" is not in the document`);
  let found = '';
  highlightTree(tree, markdownHighlightStyle, (from, to, classes) => {
    if (from <= at && at + text.length <= to) found = classes;
  });
  return found;
}

const fence = (info: string, body: string) => `intro\n\n\`\`\`${info}\n${body}\n\`\`\`\n\noutro`;

describe('fencedCodeLanguage', () => {
  it.each(['yaml', 'yml', 'YAML'])('knows %s', (info) => {
    expect(fencedCodeLanguage(info)?.name).toBe('yaml');
  });

  it.each(['', 'json', 'js', 'mermaid'])('returns null for "%s"', (info) => {
    expect(fencedCodeLanguage(info)).toBeNull();
  });
});

describe('YAML highlighting inside a Markdown fence', () => {
  const body = 'type: person\nfirst_name: Clay\nemail: "clay@example.com"\ncell_phone: 5551234567\n# note';

  it.each(['yaml', 'yml'])('colours keys differently from values in a %s block', (info) => {
    const doc = fence(info, body);
    const key = classOf(doc, 'first_name');
    expect(key).not.toBe('');
    expect(key).toBe(classOf(doc, 'email'));
    expect(key).not.toBe(classOf(doc, 'Clay'));
    expect(key).not.toBe(classOf(doc, '"clay@example.com"'));
    expect(key).not.toBe(classOf(doc, '5551234567'));
    expect(key).not.toBe(classOf(doc, '# note'));
  });

  it('leaves an untagged block as uniformly coloured code', () => {
    const doc = fence('', 'first_name: Clay');
    expect(classOf(doc, 'first_name: Clay')).not.toBe('');
    expect(classOf(doc, 'first_name')).toBe(classOf(doc, 'Clay'));
  });

  it('leaves a block in an unlisted language as uniformly coloured code', () => {
    const doc = fence('json', '{"first_name": "Clay"}');
    expect(classOf(doc, '"first_name"')).toBe(classOf(doc, '"Clay"'));
  });

  it('does not change highlighting outside the block', () => {
    const doc = fence('yaml', body);
    expect(classOf(doc, 'intro')).toBe('');
    expect(classOf(doc, 'outro')).toBe('');
  });
});
