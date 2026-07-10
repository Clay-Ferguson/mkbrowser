import { EditorView } from '@codemirror/view';
import { type FontSize } from '../../store';
import { MONO_FONT_STACK } from '../../renderer/styles';

export const FONT_SIZE_MAP: Record<FontSize, string> = {
  small: '12px',
  medium: '14px',
  large: '16px',
  xlarge: '18px',
};

// Shared font-size / base theme used by both the editable CodeMirrorEditor and the read-only
// DiffReviewEditor. Returns a fresh theme so callers can swap it in a compartment when the
// font-size setting changes.
export function createFontSizeTheme(fontSize: FontSize) {
  return EditorView.theme({
    '&': {
      fontSize: FONT_SIZE_MAP[fontSize],
      // Cap the editor at the host-provided height (set by CodeMirrorEditor from the
      // BrowseView scroll area) so CodeMirror virtualizes rendering instead of growing
      // to full content height. Inert (no cap) when the host doesn't set the variable.
      maxHeight: 'var(--cm-max-height, none)',
      // Expanded-editor mode sets this to 100% so the editor fills its flexed parent even
      // when the content is short. Inert (auto) otherwise.
      height: 'var(--cm-height, auto)',
    },
    '.cm-scroller': {
      fontFamily: MONO_FONT_STACK,
      overflow: 'auto',
    },
    '.cm-content, .cm-gutter': {
      minHeight: '75px',
    },
    '.cm-content': {
      caretColor: 'white',
    },
    '&.cm-focused': {
      outline: 'none',
    },
  });
}
