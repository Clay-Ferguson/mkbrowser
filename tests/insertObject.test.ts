/**
 * "Insert Object" in the editor: how the picked type's empty object is written into the file's
 * front matter (`planObjectInsertion`), when that is refused, and the context menu that offers it.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { objectTypeOptions, planObjectInsertion } from '../src/shared/objects/userTypes';
import { resolveFrontMatterObject } from '../src/shared/objects/genericObject';
import { parseFrontMatter } from '../src/shared/frontMatterUtil';
import type { TypeDefinitions } from '../src/shared/shared';
import { EditorContextMenu } from '../src/components/editor/EditorContextMenu';
import type { ContextMenuState } from '../src/components/editor/useEditorContextMenu';

/**
 * User-defined types as the Types Editor saves them. `person` carries descriptions and
 * property types that must NOT appear in the front matter — only the data keys do.
 */
const TYPE_DEFS: TypeDefinitions = {
  person: {
    description: 'A contact',
    properties: Object.fromEntries(
      ['name', 'email', 'notes'].map((k) => [
        k,
        { description: `the ${k}`, type: k === 'email' ? 'email' : 'text' },
      ]),
    ),
  },
  book: { properties: { title: { description: 'Title', type: 'text' } } },
  empty: { properties: {} },
};

/**
 * Inserts an object of `type` into `doc` and returns the resulting document with `|` at the
 * new cursor position. Fails the test if the insertion is refused.
 */
function insert(doc: string, type = 'person'): string {
  const plan = planObjectInsertion(doc, TYPE_DEFS, type);
  if (!plan.ok) throw new Error(plan.error);
  const text = doc.slice(0, plan.from) + plan.insert + doc.slice(plan.to);
  return `${text.slice(0, plan.cursor)}|${text.slice(plan.cursor)}`;
}

/** The refusal message for inserting `type` into `doc` (fails the test if it is accepted). */
function refusal(doc: string, type = 'person'): string {
  const plan = planObjectInsertion(doc, TYPE_DEFS, type);
  if (plan.ok) throw new Error('expected the insertion to be refused');
  return plan.error;
}

describe('planObjectInsertion', () => {
  it('creates front matter when the document has none', () => {
    expect(insert('# Title\n\nBody.')).toBe('---\ntype: person\nname: |\nemail: \nnotes: \n---\n# Title\n\nBody.');
  });

  it('works on an empty document', () => {
    expect(insert('', 'book')).toBe('---\ntype: book\ntitle: |\n---\n');
  });

  it('adds the object at the top of existing front matter, keeping what was there', () => {
    expect(insert('---\nid: abc\ntags:\n  - x\n---\nBody.', 'book'))
      .toBe('---\ntype: book\ntitle: |\nid: abc\ntags:\n  - x\n---\nBody.');
  });

  it('keeps comments and hand formatting in the existing front matter', () => {
    expect(insert('---\n# my note\nid:   abc\n---\nBody', 'book'))
      .toBe('---\ntype: book\ntitle: |\n# my note\nid:   abc\n---\nBody');
  });

  it('fills an empty front-matter block', () => {
    expect(insert('---\n---\nBody', 'book')).toBe('---\ntype: book\ntitle: |\n---\nBody');
    expect(insert('---\n\n---\nBody', 'book')).toBe('---\ntype: book\ntitle: |\n---\nBody');
  });

  it('leaves properties that are already there but blank where they are', () => {
    expect(insert('---\nid: abc\nemail:\nnotes: ""\n---\nBody'))
      .toBe('---\ntype: person\nname: |\nid: abc\nemail:\nnotes: ""\n---\nBody');
  });

  it('puts the cursor on the first property even when it was already there, blank', () => {
    expect(insert('---\nid: abc\nname:\n---\nBody')).toBe('---\ntype: person\nemail: \nnotes: \nid: abc\nname:|\n---\nBody');
  });

  it('gives a blank type line the type name, in place, adding the missing properties after it', () => {
    expect(insert('---\nid: abc\ntype:\n---\nBody', 'book')).toBe('---\nid: abc\ntype: book\ntitle: |\n---\nBody');
  });

  it('puts the cursor at the end of the type line for a type with no properties', () => {
    expect(insert('Body', 'empty')).toBe('---\ntype: empty|\n---\nBody');
  });

  it('never touches the body, including its line endings', () => {
    const body = 'line one\r\nline two\r\n---\r\nnot: front matter\r\n';
    const out = insert(`---\r\nid: abc\r\n---\r\n${body}`, 'book').replace('|', '');
    expect(out.endsWith(`\n---\n${body}`)).toBe(true);
  });

  it('writes only the data keys, never descriptions or property types', () => {
    const out = insert('Body');
    expect(out).not.toContain('description');
    expect(out).not.toContain('the name');
  });

  it('produces front matter that resolves to the type (an untitled card until filled in)', () => {
    const doc = insert('---\nid: abc\n---\nBody').replace('|', '');
    const yaml = parseFrontMatter(doc).yaml!;
    const resolved = resolveFrontMatterObject(yaml, TYPE_DEFS);
    expect(resolved?.kind).toBe('object');
    expect(resolved?.kind === 'object' && resolved.data.title?.value).toBe('');
    expect(yaml['id']).toBe('abc');
  });

  it('refuses an object of another type', () => {
    expect(refusal('---\ntype: book\ntitle: Dune\n---\nBody')).toMatch(/already holds an object \(type: book\)/);
    expect(refusal('---\ntype: robot\n---\nBody')).toMatch(/already holds an object \(type: robot\)/);
    expect(refusal('---\ntype: 5\n---\nBody')).toMatch(/already holds an object \(type: 5\)/);
  });

  it('fills in the missing properties of an object of the same type, after the existing ones', () => {
    expect(insert('---\ntype: person\nname: Clay\n---\nBody'))
      .toBe('---\ntype: person\nname: Clay\nemail: |\nnotes: \n---\nBody');
  });

  it('matches the existing type ignoring surrounding whitespace', () => {
    expect(insert('---\ntype: "person "\nname: Clay\n---\nBody'))
      .toBe('---\ntype: "person "\nname: Clay\nemail: |\nnotes: \n---\nBody');
  });

  it('changes nothing but the cursor when the object already has every property', () => {
    expect(insert('---\ntype: person\nname: Clay\nemail: c@x.com\nnotes: hi\n---\nBody'))
      .toBe('---\ntype: person\nname: Clay|\nemail: c@x.com\nnotes: hi\n---\nBody');
  });

  it('keeps properties that already have a value, whatever it is', () => {
    expect(insert('---\nname: Clay\n---\nBody'))
      .toBe('---\ntype: person\nemail: |\nnotes: \nname: Clay\n---\nBody');
    expect(insert('---\nnotes: [a, b]\nname: 5\nemail:\n---\nBody'))
      .toBe('---\ntype: person\nnotes: [a, b]\nname: 5\nemail:|\n---\nBody');
  });

  it('refuses malformed front matter', () => {
    expect(refusal('---\nname: [unclosed\n---\nBody')).toMatch(/not valid YAML/);
  });

  it('refuses front matter that is not a mapping', () => {
    expect(refusal('---\n- a\n- b\n---\nBody')).toMatch(/not a set of "key: value" properties/);
  });

  it('refuses flow-style front matter it cannot add lines to', () => {
    expect(refusal('---\n{id: abc}\n---\nBody')).toMatch(/one "key: value" per line/);
  });

  it('refuses an undefined type', () => {
    expect(refusal('Body', 'gadget')).toMatch(/not a defined type/);
    expect(refusal('Body', 'toString')).toMatch(/not a defined type/);
  });
});

describe('objectTypeOptions', () => {
  it('labels each type with its description (or its name when it has none), sorted by label', () => {
    expect(objectTypeOptions(TYPE_DEFS)).toEqual([
      { type: 'person', label: 'A contact' },
      { type: 'book', label: 'book' },
      { type: 'empty', label: 'empty' },
    ]);
  });

  it('is empty when no types are defined', () => {
    expect(objectTypeOptions({})).toEqual([]);
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
    onPasteMarkdownLink: noop,
    onSelectAll: noop,
    onSearchReplace: noop,
    onSpellingSuggestion: noop,
    onInsertTimestamp: noop,
    onInsertDate: noop,
    onOpenInsertObject: noop,
    onInsertObject: noop,
    objectTypes: objectTypeOptions(defs),
    onToggleThesaurus: noop,
    canToggleThesaurus: false,
    thesaurusEnabled: false,
    onToggleWordWrap: noop,
    wordWrap: true,
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
