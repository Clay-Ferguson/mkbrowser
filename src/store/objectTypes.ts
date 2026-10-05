import { getState } from './core';
import type { StoreSet } from './core';
import type { TypeDefinitions } from '../shared/shared';

// ============================================================================
// Object types - renderer mirror of the user-defined `types:` config
// ============================================================================

/**
 * Actions owned by this slice. Composed into the single store's state type in
 * `core.ts`.
 */
export interface ObjectTypesSlice {
  setTypeDefs: (typeDefs: TypeDefinitions) => void;
}

export function createObjectTypesSlice(set: StoreSet): ObjectTypesSlice {
  return {
    setTypeDefs: (typeDefs: TypeDefinitions) => {
      set({ typeDefs });
    },
  };
}

/**
 * Replace the store's copy of the user-defined object types. Called with the persisted
 * value at startup (`loadConfig`) and after each successful Types Editor save, so readers
 * such as the editor's "Insert Object" menu always see what is on disk. This only mirrors —
 * persisting is the caller's job (`api.updateConfig({ types })`).
 */
export function setTypeDefs(typeDefs: TypeDefinitions): void {
  getState().setTypeDefs(typeDefs);
}

/** Non-reactive read of the user-defined object types. */
export function getTypeDefs(): TypeDefinitions {
  return getState().typeDefs;
}
