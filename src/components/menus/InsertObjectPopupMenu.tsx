import type { RefObject } from 'react';
import PopupMenu, { PopupMenuItem } from './base/PopupMenu';
import type { ObjectTypeOption } from '../../shared/objects/userTypes';

interface InsertObjectPopupMenuProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** The user-defined object types (Types Editor), listed by description — see objectTypeOptions. */
  objectTypes: readonly ObjectTypeOption[];
  /** An object type picked: add an empty object of it to the file's front matter. */
  onInsertObject: (type: string) => void;
}

/**
 * Popup menu for the Insert Object (cube) button on the edit-mode toolbar (EntryEditToolbar),
 * just left of the "Editing actions" hamburger while a Markdown file is being edited. Lists
 * the user-defined object types; picking one makes the file's front matter an object of that
 * type (CodeMirrorEditorHandle.insertObject). With no types defined yet it shows a single
 * disabled hint pointing at the Types Editor.
 *
 * See: (USER_GUIDE.md#inserting-an-object-into-a-document)
 * See: (popup_menus.md#2-specific-menu-components--srccomponentsmenus)
 * See: (popup_menus.md#menus-inside-clickable-rows)
 */
export default function InsertObjectPopupMenu({ anchorRef, onClose, objectTypes, onInsertObject }: InsertObjectPopupMenuProps) {
  return (
    <PopupMenu anchorRef={anchorRef} onClose={onClose} align="right" data-testid="insert-object-popup-menu">
      {objectTypes.length === 0 ? (
        <PopupMenuItem
          label="No object types defined (see Types Editor)"
          data-testid="menu-insert-object-none"
          disabled
          onClick={onClose}
        />
      ) : (
        objectTypes.map(({ type, label }) => (
          <PopupMenuItem
            key={type}
            // The label is the type's description, or its name when it has none.
            label={label}
            data-testid={`menu-insert-object-${type}`}
            onClick={() => { onInsertObject(type); onClose(); }}
          />
        ))
      )}
    </PopupMenu>
  );
}
