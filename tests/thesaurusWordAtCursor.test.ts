/**
 * Tests for the two cursor-position rules of the thesaurus feature
 * (src/renderer/editor/editorThesaurusUtil.ts): the cursor→word step that decides what is
 * looked up, and the cursor→offset step that decides where a clicked synonym lands.
 *
 * This is the part of the feature the user actually feels: park the cursor on a word and
 * synonyms for THAT word appear. Getting the boundary wrong (off by one at either end,
 * or picking a word up from front matter) is silent — the pane just shows the wrong list.
 *
 * Documents are built as bare EditorStates, which need no DOM.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { thesaurusWordAtCursor, synonymInsertPos, MIN_THESAURUS_WORD_LENGTH } from '../src/renderer/editor/editorThesaurusUtil';

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

/**
 * Clicking a pill inserts the synonym *after* the word rather than replacing it, so this
 * offset is the whole behaviour: land it one character early and the insertion splits a
 * word in half. The rule is "first whitespace at or after the cursor, else end of line".
 */
describe('synonymInsertPos', () => {
  /** The document as it would read after clicking a pill for `synonym`. */
  function afterInsert(doc: string, pos: number, synonym: string): string {
    const at = synonymInsertPos(stateAt(doc, pos));
    if (at === null) return doc;
    return doc.slice(0, at) + ' ' + synonym + doc.slice(at);
  }

  it('inserts past the end of the word the cursor is inside', () => {
    const doc = 'the witness replied to me';
    expect(afterInsert(doc, doc.indexOf('plied'), 'answered'))
      .toBe('the witness replied answered to me');
  });

  it('inserts past the word from either of its edges', () => {
    const doc = 'the witness replied to me';
    const start = doc.indexOf('replied');
    expect(synonymInsertPos(stateAt(doc, start))).toBe(start + 'replied'.length);
    expect(synonymInsertPos(stateAt(doc, start + 'replied'.length))).toBe(start + 'replied'.length);
  });

  it('inserts at the cursor when it already sits on whitespace', () => {
    const doc = 'one two';
    expect(afterInsert(doc, 3, 'x')).toBe('one x two');
  });

  it('stops at the end of the line, not the end of the document', () => {
    // The scan never has to cross a line: the break is itself whitespace.
    const doc = 'first line\nsecond line';
    expect(afterInsert(doc, doc.indexOf('irst'), 'initial')).toBe('first initial line\nsecond line');
    const lastWord = doc.indexOf('line', 11);
    expect(afterInsert(doc, lastWord, 'row')).toBe('first line\nsecond line row');
  });

  it('inserts at the end of the document when no whitespace follows', () => {
    const doc = 'trailing word';
    expect(afterInsert(doc, doc.length, 'term')).toBe('trailing word term');
  });

  it('keeps punctuation attached to the original word', () => {
    // Following the whitespace rule literally: a trailing comma belongs to the word being
    // replaced, so the synonym goes after it and the user deletes "replied," as one unit.
    const doc = 'he replied, softly';
    expect(afterInsert(doc, doc.indexOf('plied'), 'answered')).toBe('he replied, answered softly');
  });

  it('handles an empty document', () => {
    expect(synonymInsertPos(stateAt('', 0))).toBe(0);
  });
});
