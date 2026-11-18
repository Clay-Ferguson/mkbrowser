import { useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { saveSettings } from '../../renderer/config';
import { useAS, setShowPropsInEditor } from '../../store';
import { planObjectInsertion } from '../../shared/objects/userTypes';

interface UseInsertObjectProps {
  viewRef: React.RefObject<EditorView | null>;
  /**
   * Shows the front matter in this editor right away (reconfigures its front-matter
   * compartment), ahead of the store setting catching up. Insert Object needs it before it
   * writes there — see insertObject.
   */
  revealFrontMatter: () => void;
}

/**
 * "Insert Object" for the CodeMirror editor: the action behind the edit toolbar's Insert Object
 * menu (InsertObjectPopupMenu), reached through CodeMirrorEditorHandle.insertObject, plus the
 * state of the alert shown when it refuses.
 *
 * See: (USER_GUIDE.md#inserting-an-object-into-a-document)
 */
export function useInsertObject({ viewRef, revealFrontMatter }: UseInsertObjectProps) {
  // Why Insert Object refused (e.g. the file already holds an object of another type); shown in an alert.
  const [insertObjectError, setInsertObjectError] = useState<string | null>(null);

  // Makes the file's front matter an object of the picked type (a file holds at most one object,
  // and it lives there): adds its `type:` line and every property the front matter doesn't have
  // yet, with a blank value, creating the front matter if needed. Existing values are kept, so
  // picking the type the file's object already is just fills in its missing properties. Refuses
  // — with an alert, changing nothing — when the file already holds an object of another type.
  //
  // The front matter is shown first, in this editor (revealFrontMatter) and in the setting, so
  // the user sees what was added; with it still hidden, the cursor guard would also clamp the
  // cursor out of the new lines. The cursor ends up on the first property, ready for its value.
  //
  // The type definitions are read at call time, so the menu and the insertion always agree with
  // what the Types Editor last saved.
  // See: (USER_GUIDE.md#inserting-an-object-into-a-document)
  const insertObject = (type: string) => {
    const view = viewRef.current;
    if (!view) return;

    const plan = planObjectInsertion(view.state.doc.toString(), useAS.getState().typeDefs, type);
    if (!plan.ok) {
      setInsertObjectError(plan.error);
      return;
    }

    revealFrontMatter();
    setShowPropsInEditor(true);
    saveSettings();
    view.dispatch({
      changes: { from: plan.from, to: plan.to, insert: plan.insert },
      selection: { anchor: plan.cursor },
      scrollIntoView: true,
    });
    view.focus();
  };

  const closeInsertObjectError = () => {
    setInsertObjectError(null);
    viewRef.current?.focus();
  };

  return { insertObject, insertObjectError, closeInsertObjectError };
}
