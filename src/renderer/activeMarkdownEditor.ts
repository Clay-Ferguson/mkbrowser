import type { CodeMirrorEditorHandle } from '../components/editor/CodeMirrorEditor';

let _activeEditor: CodeMirrorEditorHandle | null = null;
let _activeEditorPath: string | null = null;

/**
 * Registers a CodeMirror editor handle as the currently active Markdown editor.
 * Called when an entry opens in edit mode. The path is stored alongside the handle
 * so that `unregisterActiveMarkdownEditor` can guard against stale unregisters when a
 * new editor opens on the same path before the old one unmounts.
 */
export function registerActiveMarkdownEditor(path: string, handle: CodeMirrorEditorHandle): void {
  _activeEditor = handle;
  _activeEditorPath = path;
}

/**
 * Unregisters the active editor only if it belongs to the given path.
 * The path guard prevents a component that unmounts after a new editor has already
 * been registered on the same path from clearing the handle it no longer owns.
 */
export function unregisterActiveMarkdownEditor(path: string): void {
  if (_activeEditorPath === path) {
    _activeEditor = null;
    _activeEditorPath = null;
  }
}

/**
 * Returns the currently active Markdown editor and its file path, or null when no
 * editor is open. Used by the global "insert link" flow to target the focused editor
 * without coupling callers to the editor component directly.
 */
export function getActiveMarkdownEditor(): { path: string; handle: CodeMirrorEditorHandle } | null {
  if (_activeEditor && _activeEditorPath) {
    return { path: _activeEditorPath, handle: _activeEditor };
  }
  return null;
}
