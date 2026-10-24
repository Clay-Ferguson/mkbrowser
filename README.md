# MkBrowser

MkBrowser is an Electron desktop app that combines a file explorer with inline Markdown rendering, image rendering, and text file editing. It shows a single folder level at a time and renders `.md` files directly within the list rather than using a separate preview pane. 

This README is aimed at developers; a separate [User Guide](docs/user_guide/USER_GUIDE.md) covers end-user usage. 

**[Demo Videos](https://clay-ferguson.github.io/videos/)**

## Features

A comprehensive list of what MkBrowser can do. See the [User Guide](docs/user_guide/USER_GUIDE.md) for full details on any item.

### Browsing & Viewing

| Feature | Description |
|---------|-------------|
| Inline Markdown rendering | `.md` files expand and render directly in the file list, no separate preview pane. |
| Inline image preview | Click an image to preview it inline within the list. |
| Expand All / Collapse All | Open or close every file in the current folder with one click. |
| Index Tree panel | Optional left-hand folder tree (configurable width, or hidden entirely). |
| Breadcrumb navigation | Click any path segment to jump up the folder hierarchy. |
| Recent Folders | Remembers up to 10 recently visited folders for quick return. |
| Up Level | Jump to the parent folder with the originating subfolder highlighted. |
| Tab bar | Switch between Browse, Chat, Search, Analysis, Graph, Settings, AI Settings, and Calendar views. |
| Hidden files filtered | Dotfiles are hidden by default. |
| Content caching | Markdown content is cached to reduce re-reads. |

### Editing

| Feature | Description |
|---------|-------------|
| In-place editing | Edit Markdown/text with a CodeMirror 6 editor, with save/cancel flow. |
| Multiple concurrent edits | Several files can be open for editing at once. |
| Editor keyboard shortcuts | `Ctrl+S` save & exit, `Ctrl+Q` abandon changes, `Esc` exit (when unchanged). |
| Thesaurus | Optional offline synonym strip under the editor; click a word to insert it after the one at the cursor. |
| Expand Editor | Full-width, distraction-free editing surface that hides other entries. |
| Automatic Table of Contents | A `<!-- TOC -->` placeholder is regenerated from headings on every save. |
| Tag Picker | Add/remove front-matter hashtags via checkboxes while editing (Obsidian-compatible). |
| Tags Editor | Define and organize your hashtag library into categories (with radio-style and multi-select categories). |
| Insert links to files | Right-click a file or folder in the tree → **Copy Path**, then right-click in the editor → **Paste Link** to insert a relative Markdown link (images inline), optionally giving the target an ID so the link repairs itself if the file moves. Right-click a Markdown heading in the tree to link straight to that heading (`file.md#heading`). |

### File Management

| Feature | Description |
|---------|-------------|
| Multi-select | Checkbox selection for batch operations. |
| Cut / Copy / Paste / Delete | Full file operations via the Edit menu or keyboard. Contextual paste icons appear at valid destinations. |
| Undo Cut | Cancel a pending move before pasting. |
| Select All / Unselect All | Bulk selection helpers. |
| Drag and drop | Move files/folders between the tree, browse view, and breadcrumbs by dragging their icon. |
| Rename | Rename via button or double-click; associated `.attach` folders are renamed automatically. |
| Trash-safe delete | Deleted items go to the OS trash rather than being permanently removed. |
| Split | Divide a file into numbered files at each double blank line. |
| Join | Merge multiple selected files into one, separated by double blank lines. |
| Single-click create from clipboard | Create a new file from clipboard content. |
| Create file/folder at position | In Document Mode, insert bars let you create content at an exact spot. |
| Run shell scripts | `Ctrl+Click` a `.sh` file to execute it; `# Terminal=false` runs it silently. |

### Document Mode & Attachments

| Feature | Description |
|---------|-------------|
| Document Mode | Treat a folder as an ordered document (notebook-style blocks) via `.INDEX.yaml`. |
| Manual reordering | Move entries up/down (or to top/bottom with Ctrl) when editing is enabled. |
| File Attachments | Associate files with a document via a `.md.attach` companion folder, shown inline in Document Mode. |

### Organization & Navigation

| Feature | Description |
|---------|-------------|
| Bookmarks | Bookmark files/folders; navigate, rename, and delete them from the Index Tree. |
| Clickable hashtags | Any rendered `#hashtag` is a live link that runs a search for that tag. |

### Search & Analysis

| Feature | Description |
|---------|-------------|
| Full-text search | Search file content or file names. |
| Search modes | Literal, Wildcard (`*`), and Advanced (JavaScript-like predicates). |
| Advanced predicates | `$()` content match, front-matter properties via `p` (e.g. `p.type`), date helpers `past()`/`future()`/`today()`, and `ts()`. |
| Search highlighting | Matches are highlighted across all rendered content, not just the results tab. |
| Saved searches | Name and save searches; rerun them from the Search menu. |
| Replace in Files | Bulk find-and-replace across all `.md`/`.txt` files recursively. |
| Folder Analysis | Recursively count and rank all hashtags across a folder. |
| Folder Graph | Interactive physics-based node graph of a folder (or of search results); pan, zoom, drag, click-to-navigate. |
| Ignored paths | Exclude named files/folders from search, replace, analysis, and graph scans. |

### Markdown Rendering

| Feature | Description |
|---------|-------------|
| GitHub Flavored Markdown | Tables, strikethrough, task lists, autolinks. |
| LaTeX math | Inline `$...$` and block `$$...$$` equations via KaTeX, with `\$` escaping for currency. |
| Wikilinks | `[[file]]`, `[[file\|alias]]`, and `[[file#section]]` linking syntax. |
| Mermaid diagrams | Fenced ` ```mermaid ` blocks render as diagrams. |
| Syntax highlighting | Fenced code blocks render with language-aware colors. |
| Column layout | A `\|\|\|` line splits content into side-by-side columns. |

### AI Features

| Feature | Description |
|---------|-------------|
| AI Chat | Integrated chat with folder-based conversation history (`HUMAN.md`/`AI.md`, plus `THINK.md` for reasoning models). |
| Branching conversations | Conversations form an `A/H/A/H` folder tree, enabling branching, forking, and multi-agent workflows. |
| Chat Thread view | Renders a full conversation as a stacked thread with a Reply button. |
| Multiple providers | Anthropic, OpenAI, Google AI, and llama.cpp (local) models. |
| Model management | Create/edit/delete named model entries with provider, vision support, and per-token cost. |
| Agentic Mode | Let the AI read, write, and delete files via tools, scoped to Allowed Folders. |
| `#file:` attachments | Embed matching files (text or images) into a prompt via `#file:<pattern>` directives. |
| AI Rewrite | AI-assisted rewrite of a file or a selection, shown as a reviewable diff. |
| Full Document Context | Give the rewrite AI awareness of all files in a Document-Mode folder. |
| AI Personas | Named system-prompt personas for chat and rewrite. |
| AI Usage Statistics | Track requests, tokens, and estimated cost per provider. |

### Calendar

| Feature | Description |
|---------|-------------|
| Calendar view | Scans front-matter `due` dates and shows them on a calendar. |
| Timed events | Optional `start` time and `duration` for non-all-day events. |
| Recurring events | iCal-style `rrule` (freq, interval, byday, until, count). |
| Live updates | Calendar updates in real time as watched files change. |
| Jump to file | Click an event to open its file in the Browse view. |
| New Event | Create calendar files from the Calendar view, optionally in a configured folder. |

### Images & Export

| Feature | Description |
|---------|-------------|
| EXIF viewer/editor | View and edit embedded image metadata (Exif, GPS, IPTC/XMP, and more). |
| Folder export | Export a folder's contents to a single Markdown file, with options for subfolders, filenames, and dividers. |
| PDF export | Export Markdown content to PDF. |
| Markdown-to-HTML autogen | An `autogen.outputFile` front-matter block regenerates a self-contained HTML file on every save. |

### Appearance & Settings

| Feature | Description |
|---------|-------------|
| Font size | Small / Medium / Large / Extra Large. |
| Content width | Narrow / Medium / Wide / Full Width. |
| Folder tree width | Hidden / Narrow / Medium / Wide. |
| Folders on top | Always sort folders above files. |
| Configurable sorting | Multiple sort orders for file listings. |
| Show Table of Contents | Toggle inline rendering of `<!-- TOC -->` blocks. |
| Desktop icon (Linux) | Install script to add MkBrowser to the application launcher. |

## Tech Stack

- **Runtime**: Electron 43 (developed with Node.js 22)
- **Build tooling**: Electron Forge + Vite 8 (Rolldown)
- **Language**: TypeScript
- **UI**: React 19, with the React Compiler for automatic memoization
- **State**: Zustand (a single store)
- **Styling**: Tailwind CSS 4 + Typography plugin
- **Markdown**: `react-markdown`, `remark-math`, `rehype-katex`, KaTeX
- **Editor**: CodeMirror 6
- **Diagrams**: Mermaid
- **Config**: YAML (`js-yaml`)
- **LangChain/LangGraph**: For Local & Cloud API Access
- **Local LLMs**: llama.cpp — you run `llama-server` yourself and point MkBrowser at its URL in AI Settings
- **Testing**: Vitest (unit tests), Playwright (end-to-end tests against the packaged app)


## Architecture Overview

MkBrowser uses Electron’s three-process architecture and follows a strict IPC boundary. Renderer code never touches the file system directly.

- **Main process**: Owns all file system operations and IPC handlers.
- **Preload**: Exposes a typed `window.electronAPI` surface to the renderer.
- **Renderer**: React UI only. It reaches the preload bridge only through the typed `api` object in `src/renderer/api.ts`, never through `window.electronAPI` directly.

Data flow:

Renderer → `api.*` (`src/renderer/api.ts`) → `window.electronAPI.*` → `ipcRenderer.invoke` → Main process handler → Node.js fs → return to renderer

## State Management

All renderer state lives in a single [Zustand](https://github.com/pmndrs/zustand) store in `src/store/`, composed from slices (`items.ts`, `search.ts`, `settings.ts`, `view.ts`, `calendar.ts`, …) and exported through the `src/store/index.ts` barrel. Components read state with selectors such as `useAS(s => s.currentPath)`. Items are stored in a `Map<path, ItemData>` for O(1) lookups, and store updates always create new objects so React re-renders. See `docs/technical_notes/DEVELOPER_GUIDE.md` for the full design.

Key item fields include:
- `isSelected` for multi-select UI
- `content` and `contentCachedAt` for Markdown caching
- `editing` for per-file edit mode (supports multiple concurrent edits)

## Configuration

MkBrowser stores its configuration in a YAML file in Electron's per-user data folder. On Linux this is `~/.config/mk-browser/config.yaml`. It holds the current browse folder, recent folders, display settings, AI model and persona settings, calendar preferences, user-defined object types, and similar preferences (see the `AppConfig` interface in `src/shared/shared.ts`). The app creates the file on first run, so you don't need to make one yourself.

## Development Workflow

### Getting Started on a Clean Ubuntu Machine

Follow these steps in order on a freshly installed Ubuntu system. Run every command from the root of the project folder unless noted otherwise. None of the scripts need to be run as root; the ones that need `sudo` will ask for your password.

#### 1. Get the source code

A fresh Ubuntu desktop install does not include `git`. Install it, then clone the repository (skip the clone if you already have the project folder):

```bash
sudo apt-get install -y git
```

```bash
git clone https://github.com/Clay-Ferguson/mkbrowser.git
```

```bash
cd mkbrowser
```

#### 2. Install system prerequisites — `install-prerequisites.sh`

```bash
./install-prerequisites.sh
```

This installs the operating-system packages (via `apt-get`, so it uses `sudo`):

| Package | Why it's needed |
|---------|-----------------|
| `curl`, `ca-certificates`, `gnupg` | Used by `install-node.sh` (step 3) to download nvm. Fresh Ubuntu installs may not include `curl`, so run this script **first**. |
| `libimage-exiftool-perl` (`exiftool`) | MkBrowser runs the system `exiftool` to save image EXIF metadata. Without it the app still runs, but EXIF saving fails. |
| `fakeroot`, `dpkg` | Required by `npm run make` / `build.sh` to create the `.deb` installer. Ubuntu ships `dpkg` but **not** `fakeroot`; without it the build fails with *"Cannot make for deb, the following external binaries need to be installed: dpkg, fakeroot"* (Forge names both even when only `fakeroot` is missing). |
| `ffmpeg`, `xdotool` | Used only by the Playwright end-to-end tests (screen-capture videos and window automation). |

The script is interactive: it shows what's currently installed and asks you to confirm before installing anything.

#### 3. Install Node.js — `install-node.sh`

```bash
./install-node.sh
```

This installs [nvm](https://github.com/nvm-sh/nvm) (into `~/.nvm`) and uses it to install **Node.js 22.22.3** (which includes `npm`), setting it as your default Node version. The same version is recorded in `.nvmrc`. The nvm installer also adds a few lines to the end of your `~/.bashrc` that load nvm in every new terminal.

When it succeeds, the script ends with `Node.js v22.22.3 installed and set as default.` If it stops without printing that line, see the troubleshooting notes below.

> ⚠️ **Use Node 22, not Node 24+.** The Electron Forge packaging tools hang indefinitely during `npm run make` on Node 24. Don't install Node from Ubuntu's `apt` repositories or change nvm's default to a newer version.

**After the script finishes, close your terminal and open a new one** (or run `source ~/.nvm/nvm.sh`). The terminal you ran the script in doesn't have `node` or `npm` yet. Then verify:

```bash
node --version
```

It should print `v22.22.3`. If you later have other Node versions installed, running `nvm use` in the project folder switches to the version in `.nvmrc`.

**Troubleshooting "command not found" for `nvm`, `node` or `npm`:**

- **Use a regular interactive terminal window** (e.g. Ubuntu's Terminal app) for this step and everything after it. `nvm` is not a program on disk; it's a shell function that `~/.bashrc` loads when an *interactive* bash shell starts. Non-interactive shells skip `~/.bashrc`, so `nvm`, `node` and `npm` are all "not found" there. This includes command runners built into tools such as Claude Code's `!` prompt and some IDE task runners, even on a correctly set-up machine.
- **If Node was never installed** (`ls ~/.nvm/versions/node` shows no `v22.22.3` folder), open a new terminal, `cd` into the project folder, and run the commands below. `nvm install` with no version reads `.nvmrc`. Older copies of `install-node.sh` had a bug that made them exit right after installing nvm on a clean machine, before installing Node.

```bash
nvm install
```

```bash
nvm alias default 22.22.3
```

#### 4. Install the project's npm packages

```bash
npm install
```

This project uses **npm** only (`package-lock.json` is the lockfile). Do not run `yarn`.

#### 5. Run the app in development mode

```bash
npm run start:linux
```

This launches MkBrowser with hot reload. On Linux the `start:linux` script disables the Chromium sandbox (`ELECTRON_DISABLE_SANDBOX=1`), which recent Ubuntu releases otherwise block for unpackaged Electron apps.

At this point you have a working development environment. The remaining steps are optional.

#### 6. (Optional) Build and install MkBrowser as a desktop app

To install MkBrowser like a normal application (so you can launch it from the app menu or as `mk-browser` from a terminal), run these three scripts in order:

```bash
./build.sh
```

Runs the unit tests and linter (via `pre-package.sh`), then runs `npm run make` to produce a `.deb` package under `out/make/deb/x64/`. The build aborts if any test or lint check fails.

```bash
./install.sh
```

Installs the `.deb` produced by `build.sh` using `sudo dpkg -i`. Note that despite its name, this script does **not** install development dependencies; it only installs the already-built app, so `build.sh` must run first. If `dpkg` reports missing dependencies, run `sudo apt-get install -f`.

```bash
./install-desktop-icon.sh
```

Adds a `mkbrowser.desktop` launcher entry to `~/.local/share/applications` so MkBrowser shows up in your application list (you can then right-click it to add it to the dock).

To pick up later code changes, re-run `./build.sh` and `./install.sh`.

> If `npm run make` fails with *"the following external binaries need to be installed: dpkg, fakeroot"*, you skipped step 2 or ran an older copy of `install-prerequisites.sh` that didn't install `fakeroot`. Install it directly with `sudo apt-get install -y fakeroot`, then re-run `./build.sh`.

### Script Reference

| Script | Purpose | When to run |
|--------|---------|-------------|
| `install-prerequisites.sh` | Installs system packages (`curl`, `exiftool`, `fakeroot`, `ffmpeg`, `xdotool`, …) via `apt-get` | Once, on a new machine (step 2) |
| `install-node.sh` | Installs nvm + Node.js 22.22.3 | Once, on a new machine (step 3) |
| `build.sh` | Tests + lint, then builds the `.deb` package | Whenever you want an installable build |
| `install.sh` | Installs the `.deb` built by `build.sh` | After each `build.sh` |
| `install-desktop-icon.sh` | Adds MkBrowser to the desktop application menu | Once, after the first `install.sh` |
| `pre-package.sh` | Runs unit tests + lint (the shared quality gate) | Called by `build.sh` and `playwright-test.sh`; can also be run on its own |
| `playwright-test.sh` | Interactive menu to rebuild and run the Playwright e2e tests, optionally generating demo videos | When running e2e tests |

### Everyday Commands

Run the app (Linux):

```bash
npm run start:linux
```

Run the app (Windows/Mac — untested, see the warning at the bottom of this file):

```bash
npm start
```

Lint (TypeScript type-check + ESLint):

```bash
npm run lint
```

Unit tests (Vitest):

```bash
npm test
```

Package (builds the app into `.vite/build/` and `out/`, without creating an installer):

```bash
npm run package
```

Make (packages the app and creates the `.deb` installer in `out/make/`):

```bash
npm run make
```

### End-to-End Tests

The Playwright e2e tests in `tests/e2e/` run against the **packaged** build, not the source, and they do not rebuild it automatically. After changing anything in `src/`, rebuild with `npm run package` before running them, or they will silently test the old code. The easiest way is the interactive script, which offers to rebuild first:

```bash
./playwright-test.sh
```

Or run them directly:

```bash
npm run test:e2e
```

The e2e tests need `ffmpeg` and `xdotool` from step 2. Generating the user-guide demo videos additionally requires the sibling `kocreator` project checked out at `../kocreator` and the [`uv`](https://docs.astral.sh/uv/) Python tool on your `PATH`; without them `playwright-test.sh` just skips video generation.

## Key Packages

In this project, `dependencies` vs `devDependencies` in `package.json` decides what ships in the packaged app. The renderer and preload bundles inline everything they import at build time, so their packages are `devDependencies`. The main process loads its packages from `node_modules` at runtime, so only those are `dependencies`. Packaging prunes every `devDependency`, so a package the main process imports must be listed in `dependencies` or the packaged app fails with `Cannot find module`. See `AGENTS.md` for details.

### Runtime Dependencies (loaded by the main process)

- `@langchain/*`, `langchain`, `deepagents` (AI chat and agentic mode)
- `unified`, `remark-*`, `rehype-*` (Markdown processing and HTML export)
- `fdir` (directory scanning), `chokidar` (file watching)
- `js-yaml` (config and front matter)
- `rrule` (recurring calendar events)
- `exifreader`, `exiftool-vendored` (image EXIF metadata)
- `zod`, `nanoid`

### Dev Dependencies (build tools, plus everything bundled into the renderer)

- `electron`, `@electron-forge/*`
- `vite`, `@vitejs/plugin-react`, `babel-plugin-react-compiler`
- `typescript`
- `react`, `react-dom`, `zustand`
- `react-markdown`, `katex`, `mermaid`, `react-syntax-highlighter`
- `codemirror` + `@codemirror/*`
- `d3-*` (Folder Graph), `react-big-calendar` (Calendar)
- `typo-js`
- `tailwindcss`, `@tailwindcss/typography`, `@tailwindcss/vite`
- `eslint` + `typescript-eslint`
- `vitest`, `@playwright/test`

## Project Structure (high level)

- **Main process**: `src/main.ts`, plus helpers in `src/main/*`
- **Preload**: `src/preload.ts`
- **Renderer entry**: `src/renderer.tsx`
- **UI**: `src/App.tsx` and `src/components/*`
- **Renderer → main bridge**: `src/renderer/api.ts`
- **State**: `src/store/*`
- **Shared types and utilities** (used by both processes): `src/shared/*`
- **Tests**: `tests/` (unit) and `tests/e2e/` (Playwright)
- **Developer docs**: `docs/technical_notes/` (start with `DEVELOPER_GUIDE.md`) and `AGENTS.md`

## Contributing Notes

- All file system access must stay in the main process.
- If you add a new IPC handler, update all three of:
  - `src/main.ts` (the `ipcMain.handle` implementation)
  - `src/preload.ts` (expose it in `contextBridge.exposeInMainWorld`)
  - `src/shared/shared.ts` (its signature in the `ElectronAPI` interface)

  Then call it from renderer code via `api.*` from `src/renderer/api.ts`.
- Keep renderer logic UI-only.
- Tailwind CSS is configured in `src/index.css` (CSS-first setup).
- Don't add `useCallback` / `useMemo`; the React Compiler handles memoization. See `AGENTS.md` for the rules it imposes.

---

*WARNING: This application is only known to work on Linux (developed/test on Ubuntu only)*