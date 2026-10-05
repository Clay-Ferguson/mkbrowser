/**
 * "Insert Object" in the editor: the empty block built for a type, and where/how it is placed
 * in the document relative to the cursor.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorState, EditorSelection } from '@codemirror/state';
import { buildObjectTemplate, parseObjectBlock } from '../src/shared/objects/objectBlock';
import { resolveObjectBlock } from '../src/components/objects/objectRegistry';
import { objectTypeOptions, userObjectTemplate } from '../src/shared/objects/userTypes';
import type { TypeDefinitions } from '../src/shared/shared';
import { objectInsertion } from '../src/renderer/editor/editorObjectUtil';
import { EditorContextMenu } from '../src/components/editor/EditorContextMenu';
import type { ContextMenuState } from '../src/components/editor/useEditorContextMenu';

const PERSON_BLOCK = [
  '```yaml',
  'type: person',
  'name: ',
  'bd: ',
  'cell_phone: ',
  'other_phone: ',
  'email: ',
  'address: ',
  'notes: ',
  '```',
].join('\n');

/**
 * User-defined types as the Types Editor saves them. `person` carries descriptions and
 * property types that must NOT appear in the inserted block — only the data keys do.
 */
const TYPE_DEFS: TypeDefinitions = {
  person: {
    description: 'A contact',
    properties: Object.fromEntries(
      ['name', 'bd', 'cell_phone', 'other_phone', 'email', 'address', 'notes'].map((k) => [
        k,
        { description: `the ${k}`, type: k === 'email' ? 'email' : 'text' },
      ]),
    ),
  },
  book: { properties: { title: { description: 'Title', type: 'text' } } },
  empty: { properties: {} },
};

/** The YAML between a block's fences. */
const bodyOf = (block: string) => block.split('\n').slice(1, -1).join('\n');

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

describe('buildObjectTemplate', () => {
  it('lists the type and every field with a blank value', () => {
    expect(buildObjectTemplate('thing', ['a', 'b']).text).toBe('```yaml\ntype: thing\na: \nb: \n```');
  });

  it('puts the cursor where the first field\'s value goes', () => {
    const { text, cursorOffset } = buildObjectTemplate('thing', ['a', 'b']);
    expect(text.slice(0, cursorOffset)).toBe('```yaml\ntype: thing\na: ');
  });

  it('puts the cursor at the end of the type line when there are no fields', () => {
    const { text, cursorOffset } = buildObjectTemplate('thing', []);
    expect(text).toBe('```yaml\ntype: thing\n```');
    expect(text.slice(0, cursorOffset)).toBe('```yaml\ntype: thing');
  });
});

describe('userObjectTemplate', () => {
  it('builds the type line plus every property name, in definition order, with blank values', () => {
    expect(userObjectTemplate(TYPE_DEFS, 'person')?.text).toBe(PERSON_BLOCK);
    expect(userObjectTemplate(TYPE_DEFS, 'book')?.text).toBe('```yaml\ntype: book\ntitle: \n```');
  });

  it('leaves out property descriptions and property types', () => {
    const text = userObjectTemplate(TYPE_DEFS, 'person')!.text;
    expect(text).not.toContain('description');
    expect(text).not.toContain('the name');
    // Every property line is just `key: ` — no value, no property type.
    const propertyLines = bodyOf(text).split('\n').slice(1);
    expect(propertyLines.every((line) => /^\w+: $/.test(line))).toBe(true);
  });

  it('puts the cursor on the first property, or the type line when there are none', () => {
    const person = userObjectTemplate(TYPE_DEFS, 'person')!;
    expect(person.text.slice(0, person.cursorOffset)).toBe('```yaml\ntype: person\nname: ');
    const empty = userObjectTemplate(TYPE_DEFS, 'empty')!;
    expect(empty.text.slice(0, empty.cursorOffset)).toBe('```yaml\ntype: empty');
  });

  it('returns null for an undefined type', () => {
    expect(userObjectTemplate(TYPE_DEFS, 'gadget')).toBeNull();
    expect(userObjectTemplate(TYPE_DEFS, 'toString')).toBeNull();
    expect(userObjectTemplate({}, 'person')).toBeNull();
  });

  it('produces a block that is recognized as its type', () => {
    expect(parseObjectBlock('yaml', bodyOf(PERSON_BLOCK))?.type).toBe('person');
  });

  it('becomes a valid object as soon as one field is filled in', () => {
    // Untouched, every value is blank: recognized as a person, but with nothing to show yet.
    expect(resolveObjectBlock('yaml', bodyOf(PERSON_BLOCK))?.kind).toBe('invalid');
    const filled = bodyOf(PERSON_BLOCK).replace('name: ', 'name: Clay');
    expect(resolveObjectBlock('yaml', filled)?.kind).toBe('object');
  });
});

describe('objectTypeOptions', () => {
  it('labels each type with its description (or its name when it has none), sorted by label', () => {
    expect(objectTypeOptions(TYPE_DEFS)).toEqual([
      { type: 'person', label: 'A contact' },
      { type: 'book', label: 'book' },
      { type: 'empty', label: 'empty' },
    ]);
    for (const { type } of objectTypeOptions(TYPE_DEFS)) expect(userObjectTemplate(TYPE_DEFS, type)).not.toBeNull();
  });

  it('is empty when no types are defined', () => {
    expect(objectTypeOptions({})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Placement in the document
// ---------------------------------------------------------------------------

const TEMPLATE = buildObjectTemplate('thing', ['a', 'b']);
const BLOCK = TEMPLATE.text;

/**
 * Inserts TEMPLATE into `doc`, where `|` marks the cursor (two `|` mark a selection), and
 * returns the resulting document with `|` at the new cursor position.
 */
function insertAt(marked: string): string {
  const anchor = marked.indexOf('|');
  const second = marked.indexOf('|', anchor + 1);
  const doc = marked.replaceAll('|', '');
  const head = second === -1 ? anchor : second - 1;
  const state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
  const next = state.update(objectInsertion(state, TEMPLATE)).state;
  const text = next.doc.toString();
  const pos = next.selection.main.head;
  expect(next.selection.main.empty).toBe(true);
  return `${text.slice(0, pos)}|${text.slice(pos)}`;
}

/** BLOCK with the cursor marker at the first field's value. */
const BLOCK_WITH_CURSOR = '```yaml\ntype: thing\na: |\nb: \n```';

describe('objectInsertion', () => {
  it('inserts into an empty document with no padding', () => {
    expect(insertAt('|')).toBe(BLOCK_WITH_CURSOR);
  });

  it('inserts on a blank line that already has blank lines around it', () => {
    expect(insertAt('above\n\n|\n\nbelow')).toBe(`above\n\n${BLOCK_WITH_CURSOR}\n\nbelow`);
  });

  it('adds a blank line above when the previous line has text', () => {
    expect(insertAt('above\n|')).toBe(`above\n\n${BLOCK_WITH_CURSOR}`);
  });

  it('adds a blank line below when the next line has text', () => {
    expect(insertAt('|\nbelow')).toBe(`${BLOCK_WITH_CURSOR}\n\nbelow`);
  });

  it('moves the block to its own lines when the cursor is at the end of a line of text', () => {
    expect(insertAt('some text|')).toBe(`some text\n\n${BLOCK_WITH_CURSOR}`);
  });

  it('pushes the rest of the line below when the cursor is at the start of a line of text', () => {
    expect(insertAt('|some text')).toBe(`${BLOCK_WITH_CURSOR}\n\nsome text`);
  });

  it('splits a line around the block when the cursor is in the middle of it', () => {
    expect(insertAt('before |after')).toBe(`before \n\n${BLOCK_WITH_CURSOR}\n\nafter`);
  });

  it('replaces the selection', () => {
    expect(insertAt('keep |drop this| keep')).toBe(`keep \n\n${BLOCK_WITH_CURSOR}\n\n keep`);
  });

  it('replaces a selection spanning several lines', () => {
    expect(insertAt('one\n|two\nthree|\nfour')).toBe(`one\n\n${BLOCK_WITH_CURSOR}\n\nfour`);
  });

  it('treats a whitespace-only line as blank', () => {
    expect(insertAt('above\n   \n|\n  \nbelow')).toBe(`above\n   \n${BLOCK_WITH_CURSOR}\n  \nbelow`);
  });

  it('always leaves the block starting at the beginning of a line', () => {
    for (const marked of ['|', 'a|b', 'a\n|', 'a\n|b', '  indented|']) {
      const text = insertAt(marked).replace('|', '');
      const at = text.indexOf(BLOCK);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at === 0 || text[at - 1] === '\n').toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The context menu
// ---------------------------------------------------------------------------

function renderMenu(contextMenu: ContextMenuState, isMarkdown: boolean, defs: TypeDefinitions = TYPE_DEFS): string {
  const noop = () => {};
  return renderToStaticMarkup(createElement(EditorContextMenu, {
    contextMenu,
    onSave: noop,
    canSave: true,
    onCut: noop,
    onCopy: noop,
    onPaste: noop,
    onSelectAll: noop,
    onSpellingSuggestion: noop,
    onInsertTimestamp: noop,
    onInsertDate: noop,
    onOpenInsertObject: noop,
    onInsertObject: noop,
    objectTypes: objectTypeOptions(defs),
    onToggleThesaurus: noop,
    canToggleThesaurus: false,
    thesaurusEnabled: false,
    isMarkdown,
  }));
}

describe('EditorContextMenu — Insert Object', () => {
  it('offers Insert Object for a markdown file', () => {
    const html = renderMenu({ visible: true, x: 0, y: 0 }, true);
    expect(html).toContain('data-testid="editor-insert-object"');
    expect(html).toContain('Insert Object');
    expect(html).toContain('Insert Timestamp');
    expect(html).not.toContain('data-testid="editor-insert-object-menu"');
  });

  it('does not offer it for a non-markdown file', () => {
    expect(renderMenu({ visible: true, x: 0, y: 0 }, false)).not.toContain('Insert Object');
  });

  it('does not offer it when no types are defined', () => {
    expect(renderMenu({ visible: true, x: 0, y: 0 }, true, {})).not.toContain('Insert Object');
  });

  it('lists the object types, and nothing else, once Insert Object is clicked', () => {
    const html = renderMenu({ visible: true, x: 0, y: 0, submenu: 'insertObject' }, true);
    expect(html).toContain('data-testid="editor-insert-object-menu"');
    expect(html).toContain('data-testid="editor-insert-object-person"');
    expect(html).toContain('data-testid="editor-insert-object-book"');
    expect(html).toContain('>A contact<');
    expect(html).toContain('title="person"');
    expect(html).not.toContain('Insert Timestamp');
    expect(html).not.toContain('Cut');
  });

  it('renders nothing while closed', () => {
    expect(renderMenu({ visible: false, x: 0, y: 0, submenu: 'insertObject' }, true)).toBe('');
  });
});
