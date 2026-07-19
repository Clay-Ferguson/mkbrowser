import { defineConfig, type Plugin } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';

// Content-Security-Policy for the packaged renderer. Delivered as a <meta> tag
// because the packaged app is loaded via file:// (loadFile), where HTTP-header
// CSP delivery (webRequest.onHeadersReceived) does not apply. Injected only at
// build time (`apply: 'build'`): the Vite dev server needs inline scripts for
// the react-refresh preamble, which a strict policy would block, and dev-only
// relaxations in a shared tag would weaken the shipped policy.
//
// - script-src 'self': no inline/eval scripts anywhere in the bundle.
// - style-src 'unsafe-inline': mermaid and KaTeX set style attributes/elements.
// - img/connect/font-src local-file:/data:: markdown images resolve to the
//   local-file:// protocol (see markdownImgResolver.tsx); Vite may inline
//   small assets as data: URIs.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' local-file: data:",
  "font-src 'self' data:",
  "connect-src 'self' local-file:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const injectCsp = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
});

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    injectCsp(),
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
