import { createContext } from 'react';

/**
 * Supplies the absolute path of the markdown file being rendered to the
 * path-dependent react-markdown overrides (links and images), which resolve
 * relative URLs against it. Passing it via context (rather than closing over it
 * in a per-entry factory) keeps those component *types* module-stable — and
 * top-level, so the React Compiler actually compiles them.
 */
export const MarkdownEntryContext = createContext<string>('');
