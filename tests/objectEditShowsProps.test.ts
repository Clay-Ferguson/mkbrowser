import { describe, it, expect, beforeEach } from 'vitest';
import { useAS } from '../src/store/core';
import { setItemContent, setItemEditing, startEditing, upsertItems } from '../src/store/items';
import { setTypeDefs } from '../src/store/objectTypes';

/**
 * Starting an edit of a markdown file whose front matter holds an object (its `type:` names a
 * user-defined type) turns on Show Properties, in the same store update as the edit itself, and
 * reports it so the caller can persist the setting. Only `type` is matched; the setting then stays
 * on until the user turns it off.
 */

const OBJECT_NOTE = '/notes/alice.md';
const PLAIN_NOTE = '/notes/plain.md';
const UNKNOWN_TYPE_NOTE = '/notes/unknown.md';
const OBJECT_TEXT = '/notes/alice.txt';

const OBJECT_CONTENT = '---\ntype: Person\nname: Alice\n---\nBody\n';

function seedFile(path: string, content: string): void {
  upsertItems([{ path, name: path.substring(path.lastIndexOf('/') + 1), isDirectory: false, modifiedTime: 1000, createdTime: 1000 }]);
  setItemContent(path, content, 1000);
}

const showProps = () => useAS.getState().settings.showPropsInEditor;

function setShowProps(showPropsInEditor: boolean): void {
  useAS.setState({ settings: { ...useAS.getState().settings, showPropsInEditor } });
}

describe('editing a file that holds an object', () => {
  beforeEach(() => {
    useAS.setState({ items: new Map() });
    setTypeDefs({ Person: { properties: { name: { description: '', type: 'text' } } } });
    seedFile(OBJECT_NOTE, OBJECT_CONTENT);
    seedFile(PLAIN_NOTE, '---\ntags: [a]\n---\nBody\n');
    seedFile(UNKNOWN_TYPE_NOTE, '---\ntype: Robot\n---\nBody\n');
    seedFile(OBJECT_TEXT, OBJECT_CONTENT);
    setShowProps(false);
  });

  it('turns on Show Properties when the edit starts, and says so', () => {
    expect(startEditing(OBJECT_NOTE)).toBe(true);
    expect(showProps()).toBe(true);
    expect(useAS.getState().items.get(OBJECT_NOTE)?.editing).toBe(true);
  });

  it('does the same for an edit started by setItemEditing (pending edit requests)', () => {
    expect(setItemEditing(OBJECT_NOTE, true)).toBe(true);
    expect(showProps()).toBe(true);
  });

  it('matches on `type` alone, even when the other properties do not fit the type', () => {
    seedFile(OBJECT_NOTE, '---\ntype: Person\nname: [not, text]\n---\n');
    expect(startEditing(OBJECT_NOTE)).toBe(true);
    expect(showProps()).toBe(true);
  });

  it('leaves the setting alone for front matter without an object', () => {
    expect(startEditing(PLAIN_NOTE)).toBe(false);
    expect(startEditing(UNKNOWN_TYPE_NOTE)).toBe(false);
    expect(showProps()).toBe(false);
  });

  it('only applies to markdown files', () => {
    expect(startEditing(OBJECT_TEXT)).toBe(false);
    expect(showProps()).toBe(false);
  });

  it('reports nothing to persist when Show Properties is already on', () => {
    setShowProps(true);
    expect(startEditing(OBJECT_NOTE)).toBe(false);
    expect(showProps()).toBe(true);
  });

  it('keeps Show Properties on after the edit ends', () => {
    startEditing(OBJECT_NOTE);
    expect(setItemEditing(OBJECT_NOTE, false)).toBe(false);
    expect(showProps()).toBe(true);
  });
});
