import type { SearchDefinition } from '../../store';

/**
 * The one dialog BrowseView has open. A single union rather than a boolean per
 * dialog, so two can never be open at once and opening one needs no reset of
 * the others. Toolbar menus are not part of it — BrowseToolbar owns those,
 * next to the buttons they anchor to — and neither is the async
 * result alerts (see BrowseView's `resultAlert`).
 */
export type BrowseOverlay =
  | { kind: 'none' }
  | { kind: 'createFile'; insertAt: number | null }
  | { kind: 'createFolder'; insertAt: number | null }
  | { kind: 'search'; definition?: SearchDefinition }
  | { kind: 'replace' }
  | { kind: 'export' }
  /** `count` is frozen when the dialog opens: it is what the user is confirming. */
  | { kind: 'deleteConfirm'; count: number }
  /** `count` is the number of selected Markdown files, frozen when the dialog opens. */
  | { kind: 'removePropsConfirm'; count: number }
  | { kind: 'cutOrphanConfirm' };

export const NO_OVERLAY: BrowseOverlay = { kind: 'none' };
