/**
 * Tests for the cursor→word step of the thesaurus feature
 * (src/renderer/editor/editorThesaurusUtil.ts).
 *
 * This is the part of the feature the user actually feels: park the cursor on a word and
 * synonyms for THAT word appear. Getting the boundary wrong (off by one at either end,
 * or picking a word up from front matter) is silent — the pane just shows the wrong list.
 *
 * Documents are built as bare EditorStates, which need no DOM.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { thesaurusWordAtCursor, MIN_THESAURUS_WORD_LENGTH } from '../src/renderer/editor/editorThesaurusUtil';

/** An editor state holding `doc` with the cursor at offset `pos`. */
function stateAt(doc: string, pos: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: pos, head: pos } });
}

/** The word found with the cursor placed just before the first occurrence of `marker`. */
function wordBefore(doc: string, marker: string): string | null {
  return thesaurusWordAtCursor(stateAt(doc, doc.indexOf(marker)));
}

describe('thesaurusWordAtCursor', () => {
  it('finds the word the cursor sits inside', () => {
    expect(wordBefore('the quick brown fox', 'uick')).toBe('quick');
  });

  it('finds the word at either of its edges', () => {
    const doc = 'the quick brown fox';
    // Clicking a word puts the cursor at one of its boundaries far more often than inside
    // it, so both edges must resolve rather than falling into the neighbouring gap.
    expect(thesaurusWordAtCursor(stateAt(doc, doc.indexOf('quick')))).toBe('quick');
    expect(thesaurusWordAtCursor(stateAt(doc, doc.indexOf('quick') + 5))).toBe('quick');
  });

  it('returns null on whitespace between words', () => {
    // ' brown' — the space is two positions past the end of "quick".
    expect(thesaurusWordAtCursor(stateAt('the quick  brown fox', 10))).toBeNull();
  });

  it('keeps contractions whole', () => {
    expect(wordBefore("we don't know", 'on')).toBe("don't");
  });

  it('stops at punctuation and digits', () => {
    expect(wordBefore('sentence ends here.', 'ere')).toBe('here');
    expect(wordBefore('item bright42 x', 'right')).toBe('bright');
  });

  it('ignores words shorter than the minimum', () => {
    expect(MIN_THESAURUS_WORD_LENGTH).toBe(3);
    // "of" is below the threshold; a two-letter word has nothing useful in a thesaurus.
    expect(wordBefore('a lot of things', 'of')).toBeNull();
    expect(wordBefore('a lot of things', 'lot')).toBe('lot');
  });

  it('finds words on any line, not just the first', () => {
    expect(wordBefore('first line\nsecond line\nthird', 'econd')).toBe('second');
  });

  it('skips YAML front matter', () => {
    // Front matter keys are structure, not prose — offering synonyms for "title" would be
    // noise, and (once pills are clickable) an invitation to corrupt the file's metadata.
    const doc = '---\ntitle: Something\n---\n\nreal prose here\n';
    expect(wordBefore(doc, 'itle')).toBeNull();
    expect(wordBefore(doc, 'rose')).toBe('prose');
  });

  it('handles an empty document and a cursor at the very end', () => {
    expect(thesaurusWordAtCursor(stateAt('', 0))).toBeNull();
    const doc = 'ending word';
    expect(thesaurusWordAtCursor(stateAt(doc, doc.length))).toBe('word');
  });
});
