import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Bundle NOTHING from node_modules into main.js — only our own source.
      //
      // The regex externalizes every bare import specifier (anything not starting
      // with '.', '/', or '\0'), i.e. all package names including deep imports like
      // 'pkg/sub/path'. Node resolves them at runtime from the node_modules shipped
      // inside the packaged app: forge.config.ts's `ignore` allowlist (see the
      // PACKAGED_PATHS comment there) keeps node_modules in the package, and
      // @electron/packager prunes devDependencies from it — so the production
      // `dependencies` in package.json are exactly what ships, with no separate
      // list to maintain. Any package the main process imports directly must be in
      // `dependencies` (not devDependencies), or it is pruned from the package and
      // the packaged app throws "Cannot find module" when that code path first runs.
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
