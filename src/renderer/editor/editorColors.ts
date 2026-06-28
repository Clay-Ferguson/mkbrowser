// Tailwind-derived hex tokens shared by the CodeMirror editor themes
// (editorDateUtil, editorFrontMatterUtil, editorHashtagUtil). These are raw hex
// values rather than Tailwind classes because EditorView.baseTheme consumes
// inline style objects, not className strings. Centralized here so the shared
// green (date + front-matter) lives in one place and cannot drift.
export const EDITOR_COLORS = {
  green400: '#4ade80',
  gray400: '#9ca3af',
  orange400: '#fb923c',
  yellow400: '#facc15',
  sky400: '#38bdf8',
  // date hover tooltip
  tooltipBg: '#166534', // green-700
  tooltipFg: '#f0fdf4', // green-50
  tooltipBorder: '#22c55e', // green-500
} as const;
