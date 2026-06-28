import type { CodeMirrorEditorHandle } from '../components/editor/CodeMirrorEditor';

let _activeEditor: CodeMirrorEditorHandle | null = null;
let _activeEditorPath: string | null = null;

export function registerActiveMarkdownEditor(path: string, handle: CodeMirrorEditorHandle): void {
  _activeEditor = handle;
  _activeEditorPath = path;
}

export function unregisterActiveMarkdownEditor(path: string): void {
  if (_activeEditorPath === path) {
    _activeEditor = null;
    _activeEditorPath = null;
  }
}

export function getActiveMarkdownEditor(): { path: string; handle: CodeMirrorEditorHandle } | null {
  if (_activeEditor && _activeEditorPath) {
    return { path: _activeEditorPath, handle: _activeEditor };
  }
  return null;
}
