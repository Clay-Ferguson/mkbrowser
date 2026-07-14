import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    react(),
    // The React Compiler (see AGENTS.md — no useCallback/useMemo anywhere in src/).
    //
    // As of @vitejs/plugin-react 6 the plugin's own `babel` option is gone: Vite 8
    // bundles with Rolldown instead of Rollup/esbuild, so Babel transforms now run
    // as a separate @rolldown/plugin-babel plugin. The old
    // `react({ babel: { plugins: [['babel-plugin-react-compiler', {}]] } })` form
    // does not error under the new plugin — it is silently ignored, which would
    // de-memoize the whole app while every gate stayed green. tsc can't catch it
    // either (tsconfig only includes src/), and compiler-coverage.mjs can't, since
    // it runs the compiler standalone rather than through Vite. The gate for this
    // line is bundle-fingerprint.mjs, run by build.sh and playwright-test.sh after
    // packaging: it fails the build if the built renderer bundle no longer contains
    // the compiler's `memo_cache_sentinel` output.
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  server: {
    watch: {
      // Ignore data folders to prevent HMR reloads when editing markdown files
      ignored: ['**/demo-data/**', '**/docs/**', '**/mkbrowser-test/**'],
    },
  },
});
