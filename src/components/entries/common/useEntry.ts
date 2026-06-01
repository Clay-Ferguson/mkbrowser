import { useEntryCore } from './useEntryCore';
import { useRename } from './useRename';
import { useDelete } from './useDelete';
import { useContentLoader } from './useContentLoader';
import { useEditMode } from './useEditMode';
import type {
  BaseEntryProps,
  EntryCoreState,
  RenameState,
  DeleteState,
  EditModeState,
} from './types';

interface UseEntryOptions {
  /** Default expanded state (Text/Markdown/Image = true; Generic/Folder = false) */
  defaultExpanded?: boolean;
  /** Whether rename selects the full name (folders) or the stem (files) */
  selectFullName?: boolean;
}

interface UseEntryResult {
  /** Spread of useEntryCore */
  core: EntryCoreState;
  /** Rename state/handlers */
  rename: RenameState;
  /** Delete state/handlers */
  del: DeleteState;
}

/**
 * Aggregator hook that runs the common core trio (useEntryCore, useRename,
 * useDelete) wired from the shared BaseEntryProps. Removes the repeated
 * hook-wiring boilerplate that every Entry component shared.
 *
 * The underlying hooks are always called unconditionally and in a stable
 * order, satisfying the Rules of Hooks.
 */
export function useEntry(props: BaseEntryProps, options: UseEntryOptions = {}): UseEntryResult {
  const { defaultExpanded, selectFullName } = options;
  const { path, name } = props.entry;

  const core = useEntryCore({ path, name, defaultExpanded });

  const rename = useRename({
    path,
    name,
    isRenaming: core.isRenaming,
    onRename: props.onRename,
    onSaveSettings: props.onSaveSettings,
    selectFullName,
  });

  const del = useDelete({ path, onDelete: props.onDelete });

  return { core, rename, del };
}

interface UseEditableEntryResult extends UseEntryResult {
  /** Loaded file content */
  content: string;
  /** Whether content is loading */
  loading: boolean;
  /** Edit mode state/handlers */
  edit: EditModeState;
}

/**
 * Aggregator hook for editable file types (Text/Markdown). Composes useEntry
 * with useContentLoader + useEditMode so those components drop their
 * content/edit wiring too.
 */
export function useEditableEntry(
  props: BaseEntryProps,
  options: UseEntryOptions & { errorMessage?: string }
): UseEditableEntryResult {
  const { errorMessage, ...entryOptions } = options;
  const { core, rename, del } = useEntry(props, entryOptions);

  const { loading, content } = useContentLoader({
    path: props.entry.path,
    modifiedTime: props.entry.modifiedTime,
    isExpanded: core.isExpanded,
    errorMessage,
  });

  const edit = useEditMode({ path: props.entry.path, content });

  return { core, rename, del, content, loading, edit };
}
