import { EditorView } from '@codemirror/view';
import { type FontSize } from '../../store';

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
    },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
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
