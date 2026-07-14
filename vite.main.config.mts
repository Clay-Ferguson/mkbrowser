import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Bundle NOTHING from node_modules into main.js — only our own source.
      //
      // The regex externalizes every bare import specifier (anything not starting
      // with '.', '/', or '\0'), i.e. all package names including deep imports like
      // 'pkg/sub/path'. Node resolves them at runtime from the node_modules that
      // the packageAfterCopy hook in forge.config.ts installs into the packaged
      // app — so the installer stays fully self-contained. Any package the main
      // process imports directly must be listed in MAIN_PROCESS_DEPENDENCIES in
      // forge.config.ts (forgetting one fails loudly: "Cannot find module" on
      // first launch of the packaged app).
      //
      // Why not bundle: Rolldown's (Vite 8) ESM→CJS interop broke fdir
      // (`import.meta.url` lowered to `undefined` in CJS output) and rrule
      // (tslib default-export destructuring throws) — both crashed the packaged
      // app at startup while every build gate stayed green. Bundling zod also
      // created a second zod instance alongside the one LangChain loads from
      // node_modules, and bundling exiftool-vendored dropped its vendored perl
      // binary from the package. Leaving everything external means Node's own
      // battle-tested loader handles every package, identical to dev — no
      // bundler interop class of bug can exist.
      external: [/^[^./\0]/],
    },
  },
});
